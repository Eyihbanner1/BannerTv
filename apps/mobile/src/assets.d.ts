/** Metro hands an image import over as a number that names the bundled asset. */
declare module '*.png' {
  const asset: number;
  export default asset;
}
