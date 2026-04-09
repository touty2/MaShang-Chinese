import mysql from "mysql2/promise";

const conn = await mysql.createConnection(process.env.DATABASE_URL);

const statements = [
  // sync_preferences - TiDB doesn't support DEFAULT with expressions for text columns
  `CREATE TABLE IF NOT EXISTS \`sync_preferences\` (
    \`id\` int AUTO_INCREMENT NOT NULL,
    \`userId\` int NOT NULL,
    \`prefsJson\` text NOT NULL,
    \`updatedAt\` bigint NOT NULL,
    CONSTRAINT \`sync_preferences_id\` PRIMARY KEY(\`id\`),
    CONSTRAINT \`sync_preferences_userId_unique\` UNIQUE(\`userId\`)
  )`,
  // sync_segmentation_overrides
  `CREATE TABLE IF NOT EXISTS \`sync_segmentation_overrides\` (
    \`id\` int AUTO_INCREMENT NOT NULL,
    \`userId\` int NOT NULL,
    \`storyId\` int NOT NULL,
    \`overridesJson\` text NOT NULL,
    \`updatedAt\` bigint NOT NULL,
    CONSTRAINT \`sync_segmentation_overrides_id\` PRIMARY KEY(\`id\`)
  )`,
  `CREATE INDEX IF NOT EXISTS \`so_user_story\` ON \`sync_segmentation_overrides\` (\`userId\`, \`storyId\`)`,
];

for (const stmt of statements) {
  try {
    await conn.query(stmt);
    console.log("OK:", stmt.substring(0, 60));
  } catch (e) {
    console.warn("WARN:", e.message.substring(0, 100));
  }
}

const [tables] = await conn.query("SHOW TABLES");
console.log(
  "All tables:",
  tables.map((t) => Object.values(t)[0])
);
await conn.end();
