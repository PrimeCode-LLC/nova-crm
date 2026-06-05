"use client";

import * as React from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  ChevronDown,
  ChevronRight,
  AlertTriangle,
  Network,
  GripVertical,
  ListTree,
  Rows3,
  ChevronsDownUp,
  ChevronsUpDown,
  Info,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { ROLES } from "@/lib/constants";
import { selectTriggerLabelByIdName } from "@/lib/base-ui-select-label";
import {
  buildHierarchyForest,
  countHierarchyNodes,
  managerAssignmentCreatesCycle,
  type HierarchyNode,
} from "@/lib/user-hierarchy-tree";
import type { Department, Role, User } from "@/lib/types";
import { cn } from "@/lib/utils";

const NONE = "__none__" as const;

const DRAG = "drag:" as const;
const DROP = "drop:" as const;
const DROP_ROOT = "drop:__root__" as const;

function RootDropBanner({ canEdit, activeDragId }: { canEdit: boolean; activeDragId: string | null }) {
  const { setNodeRef, isOver } = useDroppable({
    id: DROP_ROOT,
    disabled: !canEdit,
  });
  if (!canEdit) return null;
  const dragging = Boolean(activeDragId);
  return (
    <div
      ref={setNodeRef}
      className={cn(
        "min-h-10 rounded-md border border-dashed px-3 py-2 text-center text-[11px] text-muted-foreground transition-colors sm:text-left",
        dragging && "border-primary/50 bg-primary/5",
        isOver && activeDragId ? "border-primary bg-primary/15 text-foreground shadow-sm" : "border-border/80",
      )}
    >
      {dragging ? (
        <span className="font-medium text-foreground">Release here for top level</span>
      ) : (
        <>
          Drop on <span className="font-medium text-foreground">Top level</span> to clear “Reports to”
        </>
      )}
    </div>
  );
}

const DEPTH_ACCENT = [
  "border-l-sky-500/85",
  "border-l-teal-500/85",
  "border-l-emerald-500/85",
  "border-l-violet-500/85",
] as const;

function matchesUserQuery(u: User, q: string): boolean {
  if (!q) return true;
  const s = q.toLowerCase();
  return (
    u.displayName.toLowerCase().includes(s) ||
    u.email.toLowerCase().includes(s) ||
    u.title?.toLowerCase().includes(s) ||
    false
  );
}

function subtreeHasMatch(node: HierarchyNode, q: string): boolean {
  if (!q) return true;
  if (matchesUserQuery(node.user, q)) return true;
  return node.children.some((c) => subtreeHasMatch(c, q));
}

function collectManagerIdsWithReports(nodes: readonly HierarchyNode[]): string[] {
  const out: string[] = [];
  const walk = (list: readonly HierarchyNode[]) => {
    for (const n of list) {
      if (n.children.length > 0) out.push(n.user.id);
      walk(n.children);
    }
  };
  walk(nodes);
  return out;
}

function deptLabel(user: User, departments: readonly Department[]): string | null {
  if (!user.departmentId) return null;
  return departments.find((d) => d.id === user.departmentId)?.name ?? null;
}

function HierarchyNodeRow({
  node,
  depth,
  collapsed,
  toggleCollapsed,
  search,
  selectedId,
  onSelect,
  departments,
  canEdit,
  activeDragId,
}: {
  node: HierarchyNode;
  depth: number;
  collapsed: ReadonlySet<string>;
  toggleCollapsed: (id: string) => void;
  search: string;
  selectedId: string | null;
  onSelect: (u: User) => void;
  departments: readonly Department[];
  canEdit: boolean;
  activeDragId: string | null;
}) {
  const u = node.user;
  const hasKids = node.children.length > 0;
  const isCollapsed = collapsed.has(u.id);
  const q = search.trim().toLowerCase();
  const dim = q && !matchesUserQuery(u, q);
  const accent = DEPTH_ACCENT[depth % DEPTH_ACCENT.length];
  const dName = deptLabel(u, departments);

  const {
    attributes: dragAttributes,
    listeners: dragListeners,
    setNodeRef: setDragRef,
    isDragging,
  } = useDraggable({
    id: `${DRAG}${u.id}`,
    disabled: !canEdit,
    data: { userId: u.id },
  });

  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: `${DROP}${u.id}`,
    disabled: !canEdit,
    data: { userId: u.id },
  });

  return (
    <div className="relative">
      <div
        ref={setDropRef}
        className={cn(
          "rounded-lg border bg-card/90 pr-2 shadow-sm transition-[box-shadow,opacity]",
          accent,
          "border-l-[3px]",
          dim && "opacity-55",
          isOver && activeDragId && activeDragId !== u.id && "ring-2 ring-primary/60 ring-offset-2 ring-offset-background",
          selectedId === u.id && "border-primary/50 bg-muted/50",
          isDragging && "opacity-40",
        )}
      >
        <div className="flex items-stretch gap-0">
          {canEdit ? (
            <button
              type="button"
              ref={setDragRef}
              className="flex w-8 shrink-0 cursor-grab touch-none items-center justify-center rounded-l-md border-r border-border/60 bg-muted/40 text-muted-foreground hover:bg-muted active:cursor-grabbing"
              aria-label={`Drag ${u.displayName} to assign manager`}
              {...dragListeners}
              {...dragAttributes}
            >
              <GripVertical className="h-4 w-4" />
            </button>
          ) : (
            <span className="w-2 shrink-0" />
          )}
          <div className="flex min-w-0 flex-1 items-center gap-1 py-1.5 pl-1">
            {hasKids ? (
              <button
                type="button"
                aria-expanded={!isCollapsed}
                aria-label={isCollapsed ? "Expand team" : "Collapse team"}
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md hover:bg-muted"
                onClick={() => toggleCollapsed(u.id)}
              >
                {isCollapsed ? (
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                )}
              </button>
            ) : (
              <span className="inline-flex h-8 w-8 shrink-0" />
            )}
            <button
              type="button"
              className="flex min-w-0 flex-1 items-center gap-2 rounded-md py-0.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => onSelect(u)}
            >
              <Avatar className="h-9 w-9 shrink-0 rounded-lg">
                <AvatarFallback className="rounded-lg bg-primary/15 text-[11px] font-semibold text-primary">
                  {u.displayName
                    .split(" ")
                    .map((n) => n[0])
                    .join("")
                    .slice(0, 2)}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium leading-tight">{u.displayName}</div>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
                  {dName ? <span className="truncate">{dName}</span> : null}
                  {u.title ? (
                    <span className="truncate">{u.title}</span>
                  ) : dName ? null : (
                    <span className="truncate">{u.email}</span>
                  )}
                </div>
              </div>
              <Badge variant="outline" className="hidden shrink-0 text-[10px] font-normal sm:inline-flex">
                {ROLES[u.roleId]?.label ?? u.roleId}
              </Badge>
              {hasKids ? (
                <span className="shrink-0 text-[10px] text-muted-foreground tabular-nums">
                  {node.children.length} rep{node.children.length === 1 ? "" : "s"}
                </span>
              ) : null}
            </button>
          </div>
        </div>
      </div>

      {hasKids && !isCollapsed ? (
        <div className="relative ml-4 mt-1 border-l border-border/50 pl-3 sm:ml-6 sm:pl-4">
          {node.children.map((child) => (
            <div key={child.user.id} className="pb-1">
              <HierarchyNodeRow
                node={child}
                depth={depth + 1}
                collapsed={collapsed}
                toggleCollapsed={toggleCollapsed}
                search={search}
                selectedId={selectedId}
                onSelect={onSelect}
                departments={departments}
                canEdit={canEdit}
                activeDragId={activeDragId}
              />
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function TreeBlock({
  nodes,
  collapsed,
  toggleCollapsed,
  search,
  selectedId,
  onSelect,
  departments,
  canEdit,
  activeDragId,
}: {
  nodes: readonly HierarchyNode[];
  collapsed: ReadonlySet<string>;
  toggleCollapsed: (id: string) => void;
  search: string;
  selectedId: string | null;
  onSelect: (u: User) => void;
  departments: readonly Department[];
  canEdit: boolean;
  activeDragId: string | null;
}) {
  return (
    <div className="space-y-2">
      {nodes.map((node) => (
        <HierarchyNodeRow
          key={node.user.id}
          node={node}
          depth={0}
          collapsed={collapsed}
          toggleCollapsed={toggleCollapsed}
          search={search}
          selectedId={selectedId}
          onSelect={onSelect}
          departments={departments}
          canEdit={canEdit}
          activeDragId={activeDragId}
        />
      ))}
    </div>
  );
}

/** Left-to-right levels: each node is a column; children continue to the right (scroll). */
function HorizontalOrgBlock({
  node,
  depth,
  collapsed,
  toggleCollapsed,
  selectedId,
  onSelect,
  departments,
  canEdit,
  activeDragId,
}: {
  node: HierarchyNode;
  depth: number;
  collapsed: ReadonlySet<string>;
  toggleCollapsed: (id: string) => void;
  selectedId: string | null;
  onSelect: (u: User) => void;
  departments: readonly Department[];
  canEdit: boolean;
  activeDragId: string | null;
}) {
  const hasKids = node.children.length > 0;
  const isCollapsed = collapsed.has(node.user.id);
  const accent = DEPTH_ACCENT[depth % DEPTH_ACCENT.length];

  const { attributes: dragAttributes, listeners: dragListeners, setNodeRef: setDragRef } = useDraggable({
    id: `${DRAG}${node.user.id}`,
    disabled: !canEdit,
    data: { userId: node.user.id },
  });
  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: `${DROP}${node.user.id}`,
    disabled: !canEdit,
    data: { userId: node.user.id },
  });

  return (
    <div className="flex flex-row items-stretch gap-0">
      <div
        ref={setDropRef}
        className={cn(
          "flex w-[200px] shrink-0 flex-col rounded-lg border bg-card/90 shadow-sm",
          accent,
          "border-l-[3px]",
          isOver && activeDragId && activeDragId !== node.user.id && "ring-2 ring-primary/50",
          selectedId === node.user.id && "border-primary/50 bg-muted/40",
        )}
      >
        <div className="flex flex-1 flex-col">
          {canEdit ? (
            <button
              type="button"
              ref={setDragRef}
              className="flex h-7 w-full cursor-grab touch-none items-center justify-center border-b border-border/60 bg-muted/30 text-muted-foreground hover:bg-muted/50 active:cursor-grabbing"
              aria-label={`Drag ${node.user.displayName}`}
              {...dragListeners}
              {...dragAttributes}
            >
              <GripVertical className="h-3.5 w-3.5" />
            </button>
          ) : null}
          <button
            type="button"
            className="flex flex-1 flex-col gap-1 p-2.5 text-left"
            onClick={() => onSelect(node.user)}
          >
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              L{depth + 1}
            </div>
            <div className="text-sm font-medium leading-snug">{node.user.displayName}</div>
            <div className="text-[11px] text-muted-foreground">
              {deptLabel(node.user, departments) ?? node.user.title ?? "-"}
            </div>
            <Badge variant="outline" className="mt-1 w-fit text-[10px]">
              {ROLES[node.user.roleId]?.label ?? node.user.roleId}
            </Badge>
          </button>
          {hasKids ? (
            <button
              type="button"
              className="flex items-center justify-center gap-1 border-t border-border/60 py-1 text-[10px] text-muted-foreground hover:bg-muted/40"
              onClick={() => toggleCollapsed(node.user.id)}
            >
              {isCollapsed ? <ChevronRight className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              {node.children.length} team
            </button>
          ) : null}
        </div>
      </div>

      {hasKids && !isCollapsed ? (
        <>
          <div className="flex w-6 shrink-0 items-center justify-center">
            <div className="h-px w-full bg-border" aria-hidden />
          </div>
          <div className="flex min-w-0 flex-row items-stretch gap-3">
            {node.children.map((child) => (
              <HorizontalOrgBlock
                key={child.user.id}
                node={child}
                depth={depth + 1}
                collapsed={collapsed}
                toggleCollapsed={toggleCollapsed}
                selectedId={selectedId}
                onSelect={onSelect}
                departments={departments}
                canEdit={canEdit}
                activeDragId={activeDragId}
              />
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}

/** Use `null` to clear manager or department; omit keys you are not changing. */
export type HierarchyPersistPayload = {
  managerId?: string | null;
  departmentId?: string | null;
  roleId?: Role;
};

export function UserHierarchyPanel({
  users,
  departments,
  currentUserId,
  canEdit,
  onPersist,
}: {
  users: readonly User[];
  departments: readonly Department[];
  currentUserId: string;
  canEdit: boolean;
  onPersist: (userId: string, patch: HierarchyPersistPayload) => Promise<void>;
}) {
  const [search, setSearch] = React.useState("");
  const [collapsed, setCollapsed] = React.useState<Set<string>>(() => new Set());
  const [layout, setLayout] = React.useState<"vertical" | "horizontal">("vertical");
  const [selected, setSelected] = React.useState<User | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [activeDragId, setActiveDragId] = React.useState<string | null>(null);
  const [dragUser, setDragUser] = React.useState<User | null>(null);

  const [editManager, setEditManager] = React.useState<string>(NONE);
  const [editDept, setEditDept] = React.useState<string>(NONE);
  const [editRole, setEditRole] = React.useState<Role>("salesperson");

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 12 },
    }),
  );

  function selectUser(u: User) {
    setSelected(u);
    setEditManager(u.managerId ?? NONE);
    setEditDept(u.departmentId ?? NONE);
    setEditRole(u.roleId);
  }

  const { roots, brokenManagerLinks, cycleOrphans } = React.useMemo(
    () => buildHierarchyForest(users),
    [users],
  );

  const filteredRoots = React.useMemo(() => {
    const q = search.trim();
    if (!q) return roots;
    return roots.filter((r) => subtreeHasMatch(r, q));
  }, [roots, search]);

  const totalPlaced = countHierarchyNodes(roots);
  const brokenIds = new Set(brokenManagerLinks.map((u) => u.id));
  const cycleIds = new Set(cycleOrphans.map((u) => u.id));

  const flatOrg = users.length > 1 && roots.length === users.length;

  function toggleCollapsed(id: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function expandAll() {
    setCollapsed(new Set());
  }

  function collapseAll() {
    setCollapsed(new Set(collectManagerIdsWithReports(roots)));
  }

  const managerCandidates = users.filter((u) => u.id !== selected?.id);

  async function handleSave() {
    if (!selected || !canEdit) return;
    setSaving(true);
    try {
      await onPersist(selected.id, {
        managerId: editManager === NONE ? null : editManager,
        departmentId: editDept === NONE ? null : editDept,
        roleId: editRole,
      });
      setSelected(null);
    } catch {
      /* errors surfaced via toast in parent */
    } finally {
      setSaving(false);
    }
  }

  async function applyManagerAssignment(draggedId: string, newManagerId: string | undefined) {
    const nextUsers = users.map((u) =>
      u.id === draggedId ? { ...u, managerId: newManagerId } : u,
    );
    if (managerAssignmentCreatesCycle(nextUsers, draggedId, newManagerId)) {
      const { toast } = await import("sonner");
      toast.error("That would create a reporting loop.");
      return;
    }
    await onPersist(draggedId, { managerId: newManagerId ?? null });
  }

  function handleDragStart(event: { active: { id: string | number } }) {
    const id = String(event.active.id);
    if (!id.startsWith(DRAG)) return;
    const uid = id.slice(DRAG.length);
    setActiveDragId(uid);
    setDragUser(users.find((u) => u.id === uid) ?? null);
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveDragId(null);
    setDragUser(null);
    if (!canEdit) return;
    const { active, over } = event;
    if (!over) return;
    const aid = String(active.id);
    const oid = String(over.id);
    if (!aid.startsWith(DRAG)) return;
    const draggedId = aid.slice(DRAG.length);
    if (oid === DROP_ROOT) {
      void applyManagerAssignment(draggedId, undefined);
      return;
    }
    if (!oid.startsWith(DROP)) return;
    const targetId = oid.slice(DROP.length);
    if (targetId === draggedId) return;
    void applyManagerAssignment(draggedId, targetId);
  }

  function handleDragCancel() {
    setActiveDragId(null);
    setDragUser(null);
  }

  return (
    <div className="space-y-4">
      {(brokenManagerLinks.length > 0 || cycleOrphans.length > 0) && (
        <div className="flex flex-wrap items-start gap-2 rounded-lg border border-warning/30 bg-warning/5 px-3 py-2 text-xs text-foreground">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
          <div className="min-w-0 space-y-1">
            {brokenManagerLinks.length > 0 ? (
              <p>
                <span className="font-medium">{brokenManagerLinks.length}</span>{" "}
                {brokenManagerLinks.length === 1
                  ? "user has a manager reference outside this roster (or is self-managed)."
                  : "users have a manager reference outside this roster (or are self-managed.)"}{" "}
                Fix them using the editor.
              </p>
            ) : null}
            {cycleOrphans.length > 0 ? (
              <p>
                <span className="font-medium">{cycleOrphans.length}</span> user
                {cycleOrphans.length === 1 ? "" : "s"} sit in a closed manager loop or unreachable branch; one
                anchor was chosen per loop so everyone still appears in the tree.
              </p>
            ) : null}
          </div>
        </div>
      )}

      {flatOrg && (
        <div className="flex gap-2 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2.5 text-xs leading-relaxed text-foreground">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
          <div>
            <p className="font-medium text-foreground">Everyone is currently top-level</p>
            <p className="mt-0.5 text-muted-foreground">
              To build a real org chart, open someone and set <strong className="text-foreground">Reports to</strong>,
              or use the <strong className="text-foreground">grip</strong> on the left and drop them onto their
              manager (or onto “Top level” to remove a manager).
            </p>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <div className="relative min-w-[200px] flex-1 max-w-md">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter by name, email, or title…"
            className="h-8"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div
            className="inline-flex rounded-lg border border-border bg-muted/30 p-0.5"
            role="group"
            aria-label="Chart layout"
          >
            <Button
              type="button"
              variant={layout === "vertical" ? "secondary" : "ghost"}
              size="sm"
              className="h-8 gap-1 px-2.5 text-xs shadow-none"
              onClick={() => setLayout("vertical")}
            >
              <ListTree className="h-3.5 w-3.5" />
              Vertical
            </Button>
            <Button
              type="button"
              variant={layout === "horizontal" ? "secondary" : "ghost"}
              size="sm"
              className="h-8 gap-1 px-2.5 text-xs shadow-none"
              onClick={() => setLayout("horizontal")}
            >
              <Rows3 className="h-3.5 w-3.5" />
              Horizontal
            </Button>
          </div>
          <Button type="button" variant="outline" size="sm" className="h-8 gap-1 text-xs" onClick={expandAll}>
            <ChevronsDownUp className="h-3.5 w-3.5" />
            Expand all
          </Button>
          <Button type="button" variant="outline" size="sm" className="h-8 gap-1 text-xs" onClick={collapseAll}>
            <ChevronsUpDown className="h-3.5 w-3.5" />
            Collapse teams
          </Button>
          <Badge variant="outline" className="h-8 gap-1 text-[10px] font-normal">
            <Network className="h-3 w-3" />
            {users.length} people · {roots.length} root{roots.length === 1 ? "" : "s"} · {totalPlaced} in tree
          </Badge>
        </div>
      </div>

      <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd} onDragCancel={handleDragCancel}>
        <div className="rounded-lg border bg-card">
          <div className="flex flex-col gap-1 border-b px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs font-medium text-muted-foreground">
              {layout === "vertical"
                ? "Reporting tree, lines show nesting; grip to drag onto a manager."
                : "Left-to-right flow, scroll sideways on wide teams."}
            </p>
            <RootDropBanner canEdit={canEdit} activeDragId={activeDragId} />
          </div>
          <ScrollArea className="max-h-[70vh] min-h-[280px]">
            <div className="p-3 pr-5">
              {filteredRoots.length === 0 ? (
                <p className="py-10 text-center text-sm text-muted-foreground">No branches match this filter.</p>
              ) : layout === "vertical" ? (
                <TreeBlock
                  nodes={filteredRoots}
                  collapsed={collapsed}
                  toggleCollapsed={toggleCollapsed}
                  search={search}
                  selectedId={selected?.id ?? null}
                  onSelect={selectUser}
                  departments={departments}
                  canEdit={canEdit}
                  activeDragId={activeDragId}
                />
              ) : (
                <div className="overflow-x-auto pb-2">
                  <div className="flex min-w-min flex-row items-stretch gap-2">
                    {filteredRoots.map((r) => (
                      <HorizontalOrgBlock
                        key={r.user.id}
                        node={r}
                        depth={0}
                        collapsed={collapsed}
                        toggleCollapsed={toggleCollapsed}
                        selectedId={selected?.id ?? null}
                        onSelect={selectUser}
                        departments={departments}
                        canEdit={canEdit}
                        activeDragId={activeDragId}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>
          </ScrollArea>
        </div>

        <DragOverlay dropAnimation={null}>
          {dragUser ? (
            <div className="flex max-w-xs items-center gap-2 rounded-lg border bg-card px-3 py-2 shadow-lg">
              <Avatar className="h-8 w-8 rounded-md">
                <AvatarFallback className="rounded-md bg-primary/15 text-[10px] font-semibold">
                  {dragUser.displayName
                    .split(" ")
                    .map((n) => n[0])
                    .join("")
                    .slice(0, 2)}
                </AvatarFallback>
              </Avatar>
              <span className="truncate text-sm font-medium">{dragUser.displayName}</span>
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      <Sheet open={selected != null} onOpenChange={(o) => !o && setSelected(null)}>
        <SheetContent className="w-full max-w-md overflow-y-auto">
          {selected && (
            <>
              <SheetHeader className="border-b pb-4">
                <div className="flex items-center gap-3">
                  <Avatar className="h-10 w-10 rounded-md">
                    <AvatarFallback className="rounded-md bg-primary/15 font-semibold text-primary">
                      {selected.displayName
                        .split(" ")
                        .map((n) => n[0])
                        .join("")
                        .slice(0, 2)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0">
                    <SheetTitle className="text-base truncate">{selected.displayName}</SheetTitle>
                    <p className="truncate text-xs text-muted-foreground">{selected.email}</p>
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap gap-1">
                  <Badge variant="outline" className="text-[10px]">
                    {ROLES[selected.roleId]?.label ?? selected.roleId}
                  </Badge>
                  {brokenIds.has(selected.id) ? (
                    <Badge variant="outline" className="border-warning/40 bg-warning/10 text-[10px] text-warning">
                      Broken manager link
                    </Badge>
                  ) : null}
                  {cycleIds.has(selected.id) ? (
                    <Badge variant="outline" className="text-[10px]">
                      Loop / synthetic root
                    </Badge>
                  ) : null}
                </div>
                {canEdit ? (
                  <p className="mt-3 text-[11px] leading-snug text-muted-foreground">
                    Tip: use the grip on the tree to drag this person onto their manager, or drop on “Top level” to
                    remove their manager.
                  </p>
                ) : null}
              </SheetHeader>

              <div className="space-y-4 py-4">
                <div className="space-y-1.5">
                  <Label className="text-xs">Reports to</Label>
                  <Select
                    value={editManager}
                    onValueChange={(v) => setEditManager(v ?? NONE)}
                    disabled={!canEdit}
                  >
                    <SelectTrigger className="h-9">
                      <SelectValue placeholder="None">
                        {editManager === NONE
                          ? "None (top of tree)"
                          : users.find((m) => m.id === editManager)?.displayName ?? "Manager"}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>None (top of tree)</SelectItem>
                      {managerCandidates.map((m) => (
                        <SelectItem key={m.id} value={m.id}>
                          {m.displayName}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs">Department</Label>
                  <Select
                    value={editDept}
                    onValueChange={(v) => setEditDept(v ?? NONE)}
                    disabled={!canEdit}
                  >
                    <SelectTrigger className="h-9">
                      <SelectValue placeholder="None">
                        {editDept === NONE ? "None" : selectTriggerLabelByIdName(editDept, departments) ?? "Department"}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>None</SelectItem>
                      {departments.map((d) => (
                        <SelectItem key={d.id} value={d.id}>
                          {d.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs">CRM role</Label>
                  <Select
                    value={editRole}
                    onValueChange={(v) => setEditRole((v as Role) ?? "salesperson")}
                    disabled={!canEdit || selected.id === currentUserId}
                  >
                    <SelectTrigger className="h-9">
                      <SelectValue>{ROLES[editRole]?.label ?? undefined}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(ROLES).map(([k, v]) => (
                        <SelectItem key={k} value={k}>
                          {v.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {selected.id === currentUserId ? (
                    <p className="text-[11px] text-muted-foreground">
                      Your CRM role cannot be changed from the org chart API.
                    </p>
                  ) : null}
                </div>

                {canEdit ? (
                  <Button type="button" className="w-full" onClick={handleSave} disabled={saving}>
                    {saving ? "Saving…" : "Apply changes"}
                  </Button>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    You can browse the hierarchy. Only directors, founders, super-admins, or org owners/admins can
                    change reporting lines.
                  </p>
                )}
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
