export type DocumentSession = {
  id: string;
  displayName: string;
  content: string;
  encoding: "UTF-8";
  lineEnding: "LF";
  isDirty: boolean;
};

export function createNewDocument(id = "untitled-1"): DocumentSession {
  return {
    id,
    displayName: "Untitled",
    content: "",
    encoding: "UTF-8",
    lineEnding: "LF",
    isDirty: false,
  };
}

export function updateDocumentContent(
  document: DocumentSession,
  content: string,
): DocumentSession {
  if (content === document.content) {
    return document;
  }

  return { ...document, content, isDirty: true };
}
