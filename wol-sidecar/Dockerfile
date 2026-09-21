FROM node:20-alpine
# openssh-client: used only for the remote-shutdown request.
RUN apk add --no-cache openssh-client
WORKDIR /app
COPY wol.js .
USER node
CMD ["node", "wol.js"]
