"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

function lineDiff(a: string, b: string): Array<{ type: "same" | "add" | "del"; text: string }> {
  const aLines = a.split("\n");
  const bLines = b.split("\n");
  const max = Math.max(aLines.length, bLines.length);
  const out: Array<{ type: "same" | "add" | "del"; text: string }> = [];
  for (let i = 0; i < max; i++) {
    const left = aLines[i];
    const right = bLines[i];
    if (left === right) {
      if (left != null) out.push({ type: "same", text: left });
    } else {
      if (left != null) out.push({ type: "del", text: left });
      if (right != null) out.push({ type: "add", text: right });
    }
  }
  return out;
}

export function ConfigDiff(props: {
  leftLabel: string;
  rightLabel: string;
  leftSystem: string;
  rightSystem: string;
  leftUser: string;
  rightUser: string;
}) {
  const system = lineDiff(props.leftSystem, props.rightSystem);
  const user = lineDiff(props.leftUser, props.rightUser);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Diff vs parent</CardTitle>
        <CardDescription>
          {props.leftLabel} → {props.rightLabel} (line-aligned)
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 md:grid-cols-2">
        <DiffBlock title="System prompt" lines={system} />
        <DiffBlock title="User template" lines={user} />
      </CardContent>
    </Card>
  );
}

function DiffBlock(props: {
  title: string;
  lines: Array<{ type: "same" | "add" | "del"; text: string }>;
}) {
  return (
    <div>
      <div className="mb-1 text-xs text-muted-foreground">{props.title}</div>
      <pre className="max-h-56 overflow-auto rounded-md bg-muted/40 p-2 font-mono text-[11px] leading-relaxed">
        {props.lines.map((line, i) => (
          <div
            key={`${i}-${line.type}`}
            className={
              line.type === "add"
                ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                : line.type === "del"
                  ? "bg-red-500/15 text-red-700 dark:text-red-300"
                  : undefined
            }
          >
            {line.type === "add" ? "+ " : line.type === "del" ? "- " : "  "}
            {line.text}
          </div>
        ))}
      </pre>
    </div>
  );
}
