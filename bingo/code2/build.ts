import { copyFile, mkdir } from "node:fs/promises";

const clients = ["gameHost", "player"];

console.log("Bouwen en syncen van clients gestart... 🚀");

for (const client of clients) {
  // 1. Bouw de TypeScript code
  const result = await Bun.build({
    entrypoints: [`./${client}/index.ts`],
    outdir: `./docs/${client}`,
    target: "browser",
    minify: false,
    sourcemap: true,
  });

  if (!result.success) {
    console.error(`❌ Fout bij het bouwen van TS voor ${client}:`);
    console.error(result.logs);
  } else {
    console.log(`✅ TS voor ${client} succesvol gebouwd naar ./docs/${client}`);
  }

  // 2. Kopieer de HTML bestanden
  try {
    // Zorg dat de doelmap bestaat (voor het geval de Bun.build hierboven faalt of leeg is)
    await mkdir(`./docs/${client}`, { recursive: true });

    // Kopieer de index.html
    await copyFile(`./${client}/index.html`, `./docs/${client}/index.html`);
    console.log(`📄 HTML voor ${client} succesvol gekopieerd!`);
  } catch (error) {
    console.warn(`⚠️ Kon index.html voor ${client} niet kopiëren (bestaat deze in ./${client}/?).`);
  }
}

export { };