declare module 'mammoth/mammoth.browser.js' {
  export interface MammothResult {
    value: string;
    messages: { type: string; message: string }[];
  }
  export interface MammothBrowser {
    convertToHtml: (input: { arrayBuffer: ArrayBuffer }) => Promise<MammothResult>;
    extractRawText: (input: { arrayBuffer: ArrayBuffer }) => Promise<MammothResult>;
  }
  const mammoth: MammothBrowser;
  export default mammoth;
}
