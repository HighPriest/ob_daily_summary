import * as esbuild from 'esbuild-wasm';
import process from "process";
import { builtinModules } from 'module';

const banner =
`/*
THIS IS A GENERATED/BUNDLED FILE BY ESBUILD
*/
`;

const prod = (process.argv[2] === "production");

const buildOptions = {
    banner: {
        js: banner,
    },
    entryPoints: ["main.ts"],
    bundle: true,
    external: [
        "obsidian",
        "electron",
        ...builtinModules
    ],
    format: "cjs",
    target: "es2016",
    logLevel: "info",
    sourcemap: prod ? false : "inline",
    treeShaking: true,
    outfile: "main.js",
};

if (prod) {
    await esbuild.build(buildOptions);
} else {
    let ctx = await esbuild.build({
        ...buildOptions,
        watch: true,
    });
}