// The project's `solid-js` resolves to the SSR build (no reactivity). The kit
// runtime primitives import the reactive build directly from the dist path
// (solid-js/dist/solid.js). This ambient declaration reuses the canonical
// `solid-js` type surface so the reactive import stays fully typed.
declare module 'solid-js/dist/solid.js' {
  export * from 'solid-js';
}
