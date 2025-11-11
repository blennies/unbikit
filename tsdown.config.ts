import esbuild from "rollup-plugin-esbuild";
import { defineConfig, type UserConfig } from "tsdown";
import { BIK_DEFINES } from "./src/bik-defines.ts";

const config: UserConfig[] = defineConfig([
  {
    attw: true,
    define: Object.assign(
      {
        "import.meta.builtInDefines": "true",
      },
      Object.fromEntries(Object.entries(BIK_DEFINES).map(([value, item]) => [value, item + ""])),
    ),
    dts: true,
    entry: {
      unbikit: "./src/bik-decoder.ts",
    },
    // exports: {
    //   devExports: "development",
    //   // customExports(pkg, context) {
    //   //   let mainExport: Record<string, any>;
    //   //   if (typeof pkg["."] === "string") {
    //   //     mainExport = {
    //   //       default: pkg["."],
    //   //     };
    //   //   } else {
    //   //     mainExport = structuredClone(pkg["."]);
    //   //   }
    //   //   const defaultExport = mainExport.default;
    //   //   delete mainExport.default;
    //   //   pkg["."] = {
    //   //     ...mainExport,
    //   //     import: defaultExport,
    //   //   };
    //   //   return pkg;
    //   // },
    // },
    format: ["esm", "commonjs"],
    hash: false,
    inputOptions: {
      checks: { circularDependency: true },
      preserveEntrySignatures: "allow-extension",
    },
    outputOptions: {
      esModule: true,
      minify: true,
      minifyInternalExports: true,
      inlineDynamicImports: true,
      sourcemap: "hidden",
      sourcemapIgnoreList: true,
    },
    platform: "neutral",
    plugins: [
      esbuild({
        format: "esm",
        mangleCache: {
          align32: "u",
          applySign: "i",
          bitPos: "A",
          bitsLeft: "f",
          calculate: "c",
          curDec: "e",
          curPtr: "a",
          getHuff: "r",
          items: "s",
          pos: "b",
          readBit: "n",
          readBits: "t",
          reset: "l",
          restorePos: "y",
          savePos: "d",
          skip: "h",
          tell: "m",
          tree: "o",
        },
        mangleProps:
          /^align32|applySign|bitPos|bitsLeft|calculate|curDec|curPtr|getHuff|items|pos|readBits?|reset|restorePos|savePos|skip|tell|tree$/,
        mangleQuoted: true,
        platform: "neutral",
        reserveProps: /^postMessage$/,
        sourceMap: true,
        target: "es2022",
      }),
    ],
    publint: true,
    target: "es2022",
    tsconfig: "./tsconfig.json",
    unused: true,
  },
]);

export default config;
