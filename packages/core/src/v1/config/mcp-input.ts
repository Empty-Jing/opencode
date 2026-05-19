import { Schema } from "effect"

export const Field = Schema.Struct({
  key: Schema.String.annotate({ description: "Input key referenced by {input:key} placeholders" }),
  label: Schema.optional(Schema.String).annotate({ description: "Label shown in the TUI prompt" }),
  type: Schema.optional(Schema.Union([Schema.Literal("text"), Schema.Literal("password")])).annotate({
    description: "Input type shown in the TUI prompt",
  }),
  required: Schema.optional(Schema.Boolean).annotate({ description: "Whether the input must be provided" }),
  default: Schema.optional(Schema.String).annotate({ description: "Default value used when the prompt is left empty" }),
  placeholder: Schema.optional(Schema.String).annotate({ description: "Placeholder shown in the TUI prompt" }),
  description: Schema.optional(Schema.String).annotate({ description: "Extra guidance shown before prompting" }),
}).annotate({ identifier: "McpInputField" })
export type Field = Schema.Schema.Type<typeof Field>

export * as ConfigMCPInputV1 from "./mcp-input"
