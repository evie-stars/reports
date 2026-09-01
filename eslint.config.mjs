import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

const ignores = [
  {
    ignores: [".next/**", "node_modules/**", "next-env.d.ts"]
  }
];

const eslintConfig = [...ignores, ...nextVitals, ...nextTypescript];

export default eslintConfig;
