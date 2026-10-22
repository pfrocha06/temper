import { CrownIcon, FlaskConicalIcon, HammerIcon, ScanEyeIcon, ServerCogIcon, type LucideIcon } from "lucide-react";
import { cn } from "cn";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { StageActor } from "@/lib/workflows";

type RoleMeta = { label: string; icon: LucideIcon; text: string; does: string };

/** One icon and accent per role, used everywhere a role appears. */
export const ROLE_META: Record<StageActor, RoleMeta> = {
  chief: { label: "Chief of Staff", icon: CrownIcon, text: "text-role-chief", does: "Holds the picture: talks with you, writes specs and tickets, curates knowledge" },
  builder: { label: "Builder", icon: HammerIcon, text: "text-role-builder", does: "Builds test-first in a worktree" },
  verifier: { label: "Verifier", icon: FlaskConicalIcon, text: "text-role-verifier", does: "Owns holdouts; proves it against the running app" },
  reviewer: { label: "Reviewer", icon: ScanEyeIcon, text: "text-role-reviewer", does: "Adversarial review of the diff" },
  server: { label: "Server", icon: ServerCogIcon, text: "text-role-server", does: "Runs gates, pushes, opens PRs" },
};

export function roleMeta(role: string): RoleMeta {
  return ROLE_META[role as StageActor] ?? ROLE_META.server;
}

const SIZES = { xs: "size-5 [&>svg]:size-3", sm: "size-6 [&>svg]:size-3.5", md: "size-8 [&>svg]:size-4", lg: "size-11 [&>svg]:size-5" } as const;

/**
 * A role's icon on a tint of its accent. `live` adds a beacon while the role is working;
 * reduced motion gets a steady ring instead.
 */
export function RoleAvatar({
  role,
  size = "sm",
  live = false,
  tooltip = true,
  className,
}: {
  role: string;
  size?: keyof typeof SIZES;
  live?: boolean;
  tooltip?: boolean | string;
  className?: string;
}) {
  const m = roleMeta(role);
  const Icon = m.icon;
  const avatar = (
    <span
      role="img"
      aria-label={typeof tooltip === "string" ? tooltip : m.label}
      className={cn(
        "relative inline-flex shrink-0 items-center justify-center rounded-full",
        "bg-[color-mix(in_oklab,currentColor_14%,transparent)] ring-1 ring-[color-mix(in_oklab,currentColor_35%,transparent)] ring-inset",
        m.text,
        SIZES[size],
        live && "motion-safe:animate-beacon motion-reduce:ring-2",
        className,
      )}
    >
      <Icon aria-hidden />
    </span>
  );
  if (!tooltip) return avatar;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{avatar}</TooltipTrigger>
      <TooltipContent>{typeof tooltip === "string" ? tooltip : m.label}</TooltipContent>
    </Tooltip>
  );
}
