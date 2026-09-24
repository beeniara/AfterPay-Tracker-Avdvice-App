import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addDays } from "@/lib/dates";
import { computeOrder } from "@/lib/ledger";
import type { InsightInstalment, InsightOrder } from "@/lib/insights";
import { AdviceParseError, ADVICE_NUM_CTX } from "./advice-prompt";
import { adviseFromOrders, NoActiveOrdersError } from "./advice";
import { ModelUnreachableError } from "./ollama";

const TODAY = "2026-09-24";
const config = { url: "http://models.test:11434", model: "test-model" };

function activeOrder(): InsightOrder {
  const instalments: InsightInstalment[] = [0, 1, 2, 3].map((n) => ({
    id: `i${n}`,
    sequence: n + 1,
    dueOn: addDays("2026-10-01", n * 14),
    principalCents: 2500,
    paidCents: 0,
    pendingCents: 0,
    waivedCents: 0,
    fees: [],
  }));
  return {
    id: "o1",
    merchant: "Glimmer Goods",
    channel: "online",
    purchasedAt: new Date("2026-09-17T00:00:00Z"),
    totalAmountCents: 10000,
    instalmentCount: 4,
    provider: { id: "p1", name: "Northwind Pay", kind: "bnpl" },
    ledger: computeOrder({ totalAmountCents: 10000, instalments, refunds: [], cancelled: false }, TODAY),
  };
}

const goodReply = JSON.stringify({
  summary: "You owe 100.00. Start with the first payment.",
  steps: [{ title: "Pay Glimmer Goods", detail: "Due first.", when: "2026-10-01", amount: 25 }],
  warnings: [],
});

function reply(content: string) {
  return { ok: true, json: async () => ({ message: { content } }), text: async () => "" };
}

describe("adviseFromOrders", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const body = (call: number) => JSON.parse((fetchMock.mock.calls[call]![1] as RequestInit).body as string);

  it("sends the data in JSON mode with a bigger context window and returns the plan", async () => {
    fetchMock.mockResolvedValueOnce(reply(goodReply));
    const result = await adviseFromOrders(config, [activeOrder()], "I get paid Thursdays", TODAY, "NZD");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]![0]).toBe("http://models.test:11434/api/chat");
    const sent = body(0);
    expect(sent).toMatchObject({ model: "test-model", stream: false, format: "json" });
    expect(sent.options).toEqual({ temperature: 0, num_ctx: ADVICE_NUM_CTX });
    expect(sent.messages.map((m: { role: string }) => m.role)).toEqual(["system", "user"]);
    expect(sent.messages[0].content).toContain("Assistance Beeniara");
    expect(sent.messages[1].content).toContain("Glimmer Goods via Northwind Pay");
    expect(sent.messages[1].content).toContain('"I get paid Thursdays"');

    expect(result.plan.steps[0]).toMatchObject({ title: "Pay Glimmer Goods", amountCents: 2500 });
    expect(result).toMatchObject({ model: "test-model", ordersShown: 1, ordersTotal: 1, droppedAmounts: 0 });
    expect(result.promptTokensEstimate).toBeGreaterThan(0);
  });

  it("removes amount chips that are not figures from the data", async () => {
    fetchMock.mockResolvedValueOnce(
      reply(
        JSON.stringify({
          summary: "You owe 100.00.",
          steps: [
            { title: "Made-up sum", detail: "d", amount: 113.63 },
            { title: "A real payment", detail: "d", amount: 25 },
            { title: "Zero", detail: "d", amount: 0 },
          ],
        }),
      ),
    );
    const result = await adviseFromOrders(config, [activeOrder()], undefined, TODAY, "NZD");
    expect(result.droppedAmounts).toBe(2);
    expect(result.plan.steps.map((s) => s.amountCents)).toEqual([undefined, 2500, undefined]);
    expect(result.plan.steps.map((s) => s.title)).toEqual(["Made-up sum", "A real payment", "Zero"]);
  });

  it("asks once more when the first reply is not a usable plan", async () => {
    fetchMock.mockResolvedValueOnce(reply("Here is my advice: pay soon!")).mockResolvedValueOnce(reply(goodReply));
    const result = await adviseFromOrders(config, [activeOrder()], undefined, TODAY, "NZD");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const second = body(1).messages;
    expect(second.map((m: { role: string }) => m.role)).toEqual(["system", "user", "assistant", "user"]);
    expect(second[2].content).toBe("Here is my advice: pay soon!");
    expect(second[3].content).toContain("That was not valid");
    expect(result.plan.summary).toContain("You owe 100.00");
  });

  it("gives up after the second bad reply", async () => {
    fetchMock.mockResolvedValue(reply("still not JSON"));
    await expect(adviseFromOrders(config, [activeOrder()], undefined, TODAY, "NZD")).rejects.toBeInstanceOf(
      AdviceParseError,
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry when the model cannot be reached", async () => {
    fetchMock.mockRejectedValue(new Error("connect ECONNREFUSED"));
    await expect(adviseFromOrders(config, [activeOrder()], undefined, TODAY, "NZD")).rejects.toBeInstanceOf(
      ModelUnreachableError,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not call the model when there is nothing to plan", async () => {
    await expect(adviseFromOrders(config, [], undefined, TODAY, "NZD")).rejects.toBeInstanceOf(NoActiveOrdersError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
