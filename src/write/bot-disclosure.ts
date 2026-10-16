// 可选的机器人声明页脚（REDDIT_BOT_DISCLOSURE=auto 时追加到发布的文本内容末尾）。

export const DEFAULT_BOT_FOOTER = "\n\n---\n^(🤖 This content was posted by an automated agent via reddit-mcp.)";

export class BotDisclosure {
  readonly enabled: boolean;
  readonly footer: string;

  constructor(enabled: boolean, footer?: string) {
    this.enabled = enabled;
    // 自定义页脚若没有前导空行，补一个，避免与正文粘连
    const f = footer ?? DEFAULT_BOT_FOOTER;
    this.footer = f.startsWith("\n") ? f : `\n\n${f}`;
  }

  apply(text: string): string {
    if (!this.enabled || this.footer.trim() === "") return text;
    // 编辑时正文可能已经带有页脚，不重复追加
    if (text.trimEnd().endsWith(this.footer.trim())) return text;
    return `${text.trimEnd()}${this.footer}`;
  }

  status() {
    return { enabled: this.enabled, custom_footer: this.footer !== `${DEFAULT_BOT_FOOTER}` };
  }
}
