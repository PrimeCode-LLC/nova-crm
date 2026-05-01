"use client";

import * as React from "react";
import { PageBody, PageHeader } from "@/components/common/page-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { UserChip } from "@/components/common/user-chip";
import { mockPermissionOverrides, mockUsers } from "@/lib/mock-data";
import { fmtDate, fmtRelative } from "@/lib/format";
import { Plus, Shield, Trash2, Info } from "lucide-react";
import { toast } from "sonner";

const RESOURCES = ["leads", "deals", "accounts", "contacts", "activities"] as const;
const ACTIONS = ["read", "write", "delete"] as const;
const SCOPES = ["own", "team", "department", "all", "custom"] as const;

export default function AdminPermissionsPage() {
  const [newOpen, setNewOpen] = React.useState(false);
  const [userId, setUserId] = React.useState("");
  const [resource, setResource] = React.useState("");
  const [action, setAction] = React.useState("");
  const [scope, setScope] = React.useState("");
  const [effect, setEffect] = React.useState<"grant" | "deny">("grant");
  const [note, setNote] = React.useState("");
  const [loading, setLoading] = React.useState(false);

  async function handleCreate() {
    if (!userId || !resource || !action || !scope) {
      toast.error("All fields are required");
      return;
    }
    setLoading(true);
    await new Promise((r) => setTimeout(r, 800));
    setLoading(false);
    toast.success("Permission override created");
    setNewOpen(false);
    setUserId(""); setResource(""); setAction(""); setScope(""); setNote("");
  }

  return (
    <>
      <PageHeader
        title="Permission Overrides"
        description="Fine-tune access per user. Overrides stack on top of role and department defaults."
        actions={
          <Button size="sm" onClick={() => setNewOpen(true)}>
            <Plus className="h-3.5 w-3.5" /> New override
          </Button>
        }
      />
      <PageBody>
        {/* Explanation banner */}
        <div className="rounded-lg border bg-muted/20 p-4 flex gap-3">
          <Info className="h-4 w-4 text-primary mt-0.5 shrink-0" />
          <div className="space-y-1 text-sm">
            <p className="font-medium">3-layer permission model</p>
            <div className="flex items-center gap-2 text-muted-foreground text-xs flex-wrap">
              <span className="rounded-md bg-background border px-2 py-0.5">Role default</span>
              <span className="text-muted-foreground/60">→</span>
              <span className="rounded-md bg-background border px-2 py-0.5">Department override</span>
              <span className="text-muted-foreground/60">→</span>
              <span className="rounded-md bg-primary/10 text-primary border border-primary/20 px-2 py-0.5 font-medium">Person override (wins)</span>
            </div>
            <p className="text-muted-foreground text-xs">
              A <em>deny</em> at any level blocks access, even if a lower layer grants it. Use sparingly — most access should flow from roles.
            </p>
          </div>
        </div>

        <div className="rounded-md border overflow-hidden">
          <div className="overflow-x-auto scrollbar-thin">
            <Table>
              <TableHeader className="bg-muted/30">
                <TableRow className="hover:bg-transparent">
                  <TableHead className="h-9">User</TableHead>
                  <TableHead className="h-9">Resource</TableHead>
                  <TableHead className="h-9">Action</TableHead>
                  <TableHead className="h-9">Scope</TableHead>
                  <TableHead className="h-9">Effect</TableHead>
                  <TableHead className="h-9">Note</TableHead>
                  <TableHead className="h-9">Created by</TableHead>
                  <TableHead className="h-9">Created</TableHead>
                  <TableHead className="h-9 w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {mockPermissionOverrides.map((po) => (
                  <TableRow key={po.id}>
                    <TableCell className="py-2">
                      <UserChip userId={po.userId} size="xs" />
                    </TableCell>
                    <TableCell className="py-2">
                      <Badge variant="outline" className="text-[10px] font-mono">
                        {po.resource}
                      </Badge>
                    </TableCell>
                    <TableCell className="py-2">
                      <Badge variant="outline" className="text-[10px] font-mono">
                        {po.action}
                      </Badge>
                    </TableCell>
                    <TableCell className="py-2">
                      <Badge variant="outline" className="text-[10px]">
                        {po.scope}
                      </Badge>
                    </TableCell>
                    <TableCell className="py-2">
                      <Badge
                        variant="outline"
                        className={`text-[10px] font-semibold uppercase ${
                          po.effect === "grant"
                            ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                            : "bg-rose-500/10 text-rose-400 border-rose-500/20"
                        }`}
                      >
                        {po.effect}
                      </Badge>
                    </TableCell>
                    <TableCell className="py-2 text-xs text-muted-foreground max-w-[240px] truncate">
                      {po.note ?? "—"}
                    </TableCell>
                    <TableCell className="py-2">
                      <UserChip userId={po.createdBy} size="xs" />
                    </TableCell>
                    <TableCell className="py-2 text-xs text-muted-foreground whitespace-nowrap">
                      {fmtDate(po.createdAt, "MMM d, yyyy")}
                    </TableCell>
                    <TableCell className="py-2">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-destructive hover:text-destructive"
                        onClick={() => toast.success("Override deleted")}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>

        <div className="text-xs text-muted-foreground">
          <span className="tabular-nums font-medium text-foreground">
            {mockPermissionOverrides.length}
          </span>{" "}
          overrides active
        </div>
      </PageBody>

      <Dialog open={newOpen} onOpenChange={setNewOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Shield className="h-4 w-4" /> New permission override
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-1">
            <div className="space-y-1.5">
              <Label className="text-xs">User</Label>
              <Select value={userId} onValueChange={(v) => setUserId(v ?? "")}>
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="Select user" />
                </SelectTrigger>
                <SelectContent>
                  {mockUsers.map((u) => (
                    <SelectItem key={u.id} value={u.id}>
                      {u.displayName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Resource</Label>
                <Select value={resource} onValueChange={(v) => setResource(v ?? "")}>
                  <SelectTrigger className="h-9">
                    <SelectValue placeholder="Resource" />
                  </SelectTrigger>
                  <SelectContent>
                    {RESOURCES.map((r) => (
                      <SelectItem key={r} value={r}>{r}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Action</Label>
                <Select value={action} onValueChange={(v) => setAction(v ?? "")}>
                  <SelectTrigger className="h-9">
                    <SelectValue placeholder="Action" />
                  </SelectTrigger>
                  <SelectContent>
                    {ACTIONS.map((a) => (
                      <SelectItem key={a} value={a}>{a}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Scope</Label>
              <Select value={scope} onValueChange={(v) => setScope(v ?? "")}>
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="Scope" />
                </SelectTrigger>
                <SelectContent>
                  {SCOPES.map((s) => (
                    <SelectItem key={s} value={s}>{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Effect</Label>
              <RadioGroup
                value={effect}
                onValueChange={(v) => setEffect(v as "grant" | "deny")}
                className="flex gap-4"
              >
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="grant" id="r-grant" />
                  <Label htmlFor="r-grant" className="text-sm text-emerald-400 cursor-pointer">Grant</Label>
                </div>
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="deny" id="r-deny" />
                  <Label htmlFor="r-deny" className="text-sm text-rose-400 cursor-pointer">Deny</Label>
                </div>
              </RadioGroup>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Note (optional)</Label>
              <Textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Why is this override needed?"
                className="h-20 text-sm resize-none"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setNewOpen(false)}>
              Cancel
            </Button>
            <Button size="sm" onClick={handleCreate} disabled={loading}>
              {loading ? "Creating…" : "Create override"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
