/**
 * fix for TS2882: "Cannot find module or type declarations for side-effect import of '{0}'."
 */
declare module '*.css' {
    const content: { [className: string]: string };
    export default content;
}
