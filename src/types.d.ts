// Fills in experimental `requestPermission` function on FileSystemDirectoryHandle
type FileSystemDirectoryHandleExperimental = FileSystemDirectoryHandle & {
  requestPermission?: (descriptor?: {
    mode?: "read" | "readwrite";
  }) => Promise<"granted" | "denied" | "prompt">;
};

declare module "https://cdn.jsdelivr.net/npm/file-system-access/lib/es2018.js" {
  export async function showDirectoryPicker(options: {
    id?: string;
    mode?: "read" | "readwrite";
    startIn?: FileSystemHandle | string;
  }): Promise<FileSystemDirectoryHandleExperimental | undefined>;
}

declare module "https://unpkg.com/idb-keyval@5.0.2/dist/esm/index.js" {
  export async function get(key: string): any;
  export async function set(key: string, value: any);
}
