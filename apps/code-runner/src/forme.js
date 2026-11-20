import { createElement, Fragment } from "react";
import { init, renderDocument as render } from "@formepdf/core/worker";
import formeModule from "./forme.wasm";

export * from "@formepdf/react";
export { createElement, createElement as h, Fragment };

export async function renderDocument(element, options) {
  await init(formeModule);
  return render(element, options);
}
