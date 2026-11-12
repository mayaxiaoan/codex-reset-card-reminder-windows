import { AppServer } from './app-server.mjs';
const client = new AppServer(undefined, process.argv.includes('--proxy') ? ['app-server', 'proxy'] : undefined);
try {
  await client.connect();
  const result = await client.request('account/rateLimits/read');
  console.log(JSON.stringify({
    accountId: result.accountId,
    availableCount: result.rateLimitResetCredits?.availableCount ?? null,
    cards: result.rateLimitResetCredits?.credits?.map(card => ({
      id: card.id, status: card.status, resetType: card.resetType, expiresAt: card.expiresAt,
    })) ?? null,
  }, null, 2));
} catch (error) { console.error(error.message); process.exitCode = 1; }
finally { client.close(); }
