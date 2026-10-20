export {};
interface WritingDirectory {
  name: string;
  getDirectoryHandle(
    name: string,
    options?: { create: boolean },
  ): Promise<WritingDirectory>;
  getFileHandle(
    name: string,
    options?: { create: boolean },
  ): Promise<{
    getFile(): Promise<File>;
    createWritable(): Promise<{
      write(data: string): Promise<void>;
      close(): Promise<void>;
      abort(): Promise<void>;
    }>;
  }>;
}
declare global {
  interface Window {
    showDirectoryPicker?: (options: {
      mode: "readwrite";
    }) => Promise<WritingDirectory>;
    winAIWriting?: {
      open(): Promise<{
        path: string;
        content: string | null;
        token: string;
      } | null>;
      save(files: Record<string, string>, token: string): Promise<void>;
    };
  }
}
