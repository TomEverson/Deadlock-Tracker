declare module 'bz2' {
  /** SheetJS bz2 (CommonJS: import the default export). `crc` checks the data (default true). */
  const bz2: { decompress(data: Uint8Array, crc?: boolean): Uint8Array }
  export default bz2
}
