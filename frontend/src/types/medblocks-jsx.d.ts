import type React from "react";

/** Medblocks UI Web Components（Lit）在 React JSX 中的型別宣告 */
declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "mb-fhir-form": React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement> & {
          plugin?: string;
          novalidate?: boolean;
          overwritectx?: boolean;
        },
        HTMLElement
      >;
      "mb-input": React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement> & { path?: string; label?: string },
        HTMLElement
      >;
      "mb-search": React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement> & { path?: string; label?: string },
        HTMLElement
      >;
    }
  }
}

export {};
