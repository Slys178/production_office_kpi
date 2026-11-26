/** The only file that talks to Azure: Table Storage, Blob Storage and Communication Services Email. */
const { TableClient } = require("@azure/data-tables");
const { BlobServiceClient } = require("@azure/storage-blob");
const { EmailClient } = require("@azure/communication-email");

function setting(name) {
  const v = process.env[name];
  if (!v) throw new Error("Missing app setting: " + name);
  return v;
}

function azureStore() {
  const connection = setting("STORAGE_CONNECTION");
  const table = TableClient.fromConnectionString(connection, "Incidents");
  const container = BlobServiceClient.fromConnectionString(connection).getContainerClient("incident-photos");
  const ready = Promise.all([
    table.createTable().catch((e) => { if (e.statusCode !== 409) throw e; }),
    container.createIfNotExists(), // private by default
  ]);

  return {
    /** Next reference number. The etag check stops two reports getting the same one. */
    async nextRef() {
      await ready;
      for (let attempt = 0; attempt < 20; attempt++) {
        try {
          let counter;
          try {
            counter = await table.getEntity("counter", "ref");
          } catch (e) {
            if (e.statusCode !== 404) throw e;
            await table.createEntity({ partitionKey: "counter", rowKey: "ref", last: 1 });
            return 1;
          }
          const next = counter.last + 1;
          await table.updateEntity({ partitionKey: "counter", rowKey: "ref", last: next }, "Replace", { etag: counter.etag });
          return next;
        } catch (e) {
          if (e.statusCode !== 409 && e.statusCode !== 412) throw e;
          await new Promise((r) => setTimeout(r, Math.random() * 200));
        }
      }
      throw new Error("Could not allocate a reference number");
    },
    async savePhoto(name, bytes, contentType) {
      await container.getBlockBlobClient(name).uploadData(bytes, { blobHTTPHeaders: { blobContentType: contentType } });
    },
    async saveReport(ref, report) {
      await table.createEntity({ partitionKey: "incident", rowKey: String(ref).padStart(8, "0"), ref, ...report });
    },
  };
}

function azureMail() {
  return {
    async send(to, message) {
      const client = new EmailClient(setting("EMAIL_CONNECTION"));
      const poller = await client.beginSend({
        senderAddress: setting("EMAIL_FROM"),
        recipients: { to: to.map((address) => ({ address })) },
        content: { subject: message.subject, plainText: message.body },
      });
      const result = await poller.pollUntilDone();
      if (result.status !== "Succeeded") throw new Error("Email status: " + result.status);
    },
  };
}

module.exports = { azureStore, azureMail };
