import { describe, expect, it } from "vitest";
import { classifyStatus, hostOf } from "./ollama";

const url = "http://100.119.142.62:11434";

describe("classifyStatus", () => {
  it("is unconfigured without a URL", () => {
    expect(classifyStatus({}, { ok: true, models: ["a"] })).toEqual({ state: "unconfigured" });
  });

  it("is unreachable when the tag list could not be fetched", () => {
    expect(classifyStatus({ url }, { ok: false, reason: "ECONNREFUSED" })).toEqual({
      state: "unreachable",
      host: "100.119.142.62:11434",
      reason: "ECONNREFUSED",
    });
  });

  it("reports no models, a missing configured model, or ready", () => {
    expect(classifyStatus({ url }, { ok: true, models: [] })).toEqual({ state: "no-models", host: "100.119.142.62:11434" });
    expect(classifyStatus({ url, model: "qwen2.5-coder:7b" }, { ok: true, models: ["llama3.1:8b"] })).toEqual({
      state: "model-missing",
      host: "100.119.142.62:11434",
      model: "qwen2.5-coder:7b",
      installed: ["llama3.1:8b"],
    });
    expect(classifyStatus({ url, model: "llama3.1:8b" }, { ok: true, models: ["llama3.1:8b"] })).toMatchObject({
      state: "ready",
      model: "llama3.1:8b",
    });
  });

  it("picks the first installed model when none is configured", () => {
    expect(classifyStatus({ url }, { ok: true, models: ["first:latest", "second:latest"] })).toMatchObject({
      state: "ready",
      model: "first:latest",
      installed: ["first:latest", "second:latest"],
    });
  });

  it("falls back to the raw string for an unparsable host", () => {
    expect(hostOf("not a url")).toBe("not a url");
  });
});
