/**
 * VAPID キー生成ユーティリティ
 * 使用方法: node scripts/setup-vapid.mjs
 *
 * 出力された値を .env.local と Vercel/GitHub Secrets に設定してください。
 */
import pkg from "web-push";
const { generateVAPIDKeys } = pkg;

const keys = generateVAPIDKeys();

console.log("\n=== VAPID Keys ===");
console.log("\n.env.local に設定:");
console.log(`NEXT_PUBLIC_VAPID_PUBLIC_KEY=${keys.publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${keys.privateKey}`);
console.log("\nGitHub Secrets に設定:");
console.log(`NEXT_PUBLIC_VAPID_PUBLIC_KEY = ${keys.publicKey}`);
console.log(`VAPID_PRIVATE_KEY = ${keys.privateKey}`);
console.log("\n注意: VAPID キーを変更するとすでに登録された通知サブスクリプションが無効になります。");
