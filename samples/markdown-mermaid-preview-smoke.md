# Markdown Mermaid Preview Smoke Test

This Markdown file checks that Textora renders fenced Mermaid blocks inside the
Markdown preview while preserving the Markdown source as the saved content.

```mermaid
flowchart TD
  Start([Open this Markdown file])
  Preview[Click Preview]
  Render{Mermaid diagram renders?}
  Edit[Edit the Mermaid source]
  Update[Preview updates after a short delay]
  Save[Save Markdown source]
  Done([Smoke test passed])

  Start --> Preview --> Render
  Render -- Yes --> Edit --> Update --> Save --> Done
  Render -- No --> Error[Read the inline preview error]
  Error --> Edit
```

Regular code blocks should remain code blocks:

```ts
const preview = "Markdown code block";
```
