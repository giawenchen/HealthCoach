import * as esbuild from "esbuild";
import { mkdirSync, statSync } from "fs";

mkdirSync("public/dist", { recursive: true });

await esbuild.build({
  entryPoints: ["src/entry.jsx"],
  bundle: true,
  outfile: "public/dist/app.js",
  format: "iife",
  platform: "browser",
  target: ["es2020", "safari14"],
  minify: true,
  legalComments: "none",
  jsx: "automatic",
  loader: { ".jsx": "jsx" },
  define: { "process.env.NODE_ENV": '"production"' },
});

const kb = statSync("public/dist/app.js").size / 1024;
console.log(`✓ public/dist/app.js (${kb.toFixed(1)} KB minified)`);
