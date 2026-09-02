import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

const ignores = [
  {
    ignores: [".next/**", "node_modules/**", "next-env.d.ts", "server.js"]
  }
];

const fontRule = [
  {
    rules: {
      "@next/next/no-page-custom-font": "off"
    }
  }
];

const eslintConfig = [...ignores, ...nextVitals, ...nextTypescript, ...fontRule];

export default eslintConfig;
