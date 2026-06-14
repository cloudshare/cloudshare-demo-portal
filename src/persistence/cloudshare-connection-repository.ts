import type { PrismaClient } from "@prisma/client";
import type {
  CloudShareConnectionRecord,
  CloudShareConnectionRepository,
  SaveCloudShareConnectionInput,
} from "@/domain/cloudshare-connection";
import type { SecretBox } from "@/security/secret-box";

export function createCloudShareConnectionRepository(
  prisma: PrismaClient,
  secrets: SecretBox,
): CloudShareConnectionRepository {
  return {
    async save(input: SaveCloudShareConnectionInput): Promise<CloudShareConnectionRecord> {
      const row = await prisma.cloudShareConnection.upsert({
        where: { customerId: input.customerId },
        update: {
          apiIdCiphertext: secrets.encrypt(input.apiId),
          apiKeyCiphertext: secrets.encrypt(input.apiKey),
          webhookSecretCiphertext: secrets.encrypt(input.webhookSecret),
          verifiedAt: null,
        },
        create: {
          customerId: input.customerId,
          apiIdCiphertext: secrets.encrypt(input.apiId),
          apiKeyCiphertext: secrets.encrypt(input.apiKey),
          webhookSecretCiphertext: secrets.encrypt(input.webhookSecret),
        },
      });
      return hydrate(row, secrets);
    },

    async findByCustomerId(customerId: string): Promise<CloudShareConnectionRecord | null> {
      const row = await prisma.cloudShareConnection.findUnique({ where: { customerId } });
      return row ? hydrate(row, secrets) : null;
    },

    async markVerified(customerId: string, verifiedAt: Date): Promise<void> {
      await prisma.cloudShareConnection.update({
        where: { customerId },
        data: { verifiedAt },
      });
    },
  };
}

function hydrate(
  row: {
    customerId: string;
    apiIdCiphertext: string;
    apiKeyCiphertext: string;
    webhookSecretCiphertext: string;
    connectedAt: Date;
    verifiedAt: Date | null;
  },
  secrets: SecretBox,
): CloudShareConnectionRecord {
  return {
    customerId: row.customerId,
    apiId: secrets.decrypt(row.apiIdCiphertext),
    apiKey: secrets.decrypt(row.apiKeyCiphertext),
    webhookSecret: secrets.decrypt(row.webhookSecretCiphertext),
    connectedAt: row.connectedAt,
    verifiedAt: row.verifiedAt,
  };
}
