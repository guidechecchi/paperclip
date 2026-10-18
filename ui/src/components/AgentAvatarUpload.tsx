import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Camera, LoaderCircle, Undo2 } from "lucide-react";
import { resolveAgentAppearance, type AgentAppearance } from "@paperclipai/shared";
import { Button } from "@/components/ui/button";
import { agentsApi } from "../api/agents";
import { queryKeys } from "../lib/queryKeys";
import { cn } from "../lib/utils";
import { AGENT_AVATAR_INPUT_ACCEPT, prepareAgentAvatarImage } from "../lib/agent-avatar-image";

export interface AgentAvatarUploadProps {
  agent: {
    id: string;
    companyId: string;
    appearance?: AgentAppearance | null;
    status?: string | null;
  };
  className?: string;
}

const AVATAR_HINT = "PNG, JPEG or WebP · up to 512 KB";

function messageFrom(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

/**
 * Upload or reset an agent profile avatar from the agent header. The server
 * normalizes the image and stores it as a company-scoped asset; every surface
 * that renders the agent appearance picks it up once the agent queries refresh.
 */
export function AgentAvatarUpload({ agent, className }: AgentAvatarUploadProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const appearance = resolveAgentAppearance(agent.appearance, agent.id);
  const hasCustomAvatar = Boolean(appearance.customAvatarAssetId);
  // The avatar endpoint rejects these states; keep the control disabled instead of failing late.
  const blocked = agent.status === "terminated" || agent.status === "pending_approval";

  const refreshAgentViews = () => {
    // Avatar URLs ride on agent projections everywhere (header, lists, org tree).
    void queryClient.invalidateQueries({ queryKey: ["agents"] });
    void queryClient.invalidateQueries({ queryKey: queryKeys.org(agent.companyId) });
  };

  const uploadMutation = useMutation({
    mutationFn: (imageBase64: string) => agentsApi.setAvatar(agent.companyId, agent.id, imageBase64),
    onSuccess: () => {
      setError(null);
      refreshAgentViews();
    },
    onError: (mutationError) => setError(messageFrom(mutationError, "Could not update the avatar.")),
  });
  const resetMutation = useMutation({
    mutationFn: () => agentsApi.setAvatar(agent.companyId, agent.id, null),
    onSuccess: () => {
      setError(null);
      refreshAgentViews();
    },
    onError: (mutationError) => setError(messageFrom(mutationError, "Could not reset the avatar.")),
  });
  const pending = uploadMutation.isPending || resetMutation.isPending;

  async function handleFile(file: File) {
    setError(null);
    try {
      const imageBase64 = await prepareAgentAvatarImage(file);
      uploadMutation.mutate(imageBase64);
    } catch (prepareError) {
      setError(messageFrom(prepareError, "Could not read the selected image."));
    }
  }

  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)} data-slot="agent-avatar-upload">
      <input
        ref={inputRef}
        type="file"
        accept={AGENT_AVATAR_INPUT_ACCEPT}
        className="sr-only"
        disabled={blocked || pending}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void handleFile(file);
        }}
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={blocked || pending}
        onClick={() => inputRef.current?.click()}
        title={AVATAR_HINT}
      >
        {uploadMutation.isPending ? <LoaderCircle className="animate-spin" /> : <Camera />}
        {hasCustomAvatar ? "Change avatar" : "Upload avatar"}
      </Button>
      {hasCustomAvatar && !blocked ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={pending}
          onClick={() => {
            setError(null);
            resetMutation.mutate();
          }}
        >
          {resetMutation.isPending ? <LoaderCircle className="animate-spin" /> : <Undo2 />}
          Use default
        </Button>
      ) : null}
      <span className={cn("text-xs", error ? "text-destructive" : "text-muted-foreground")}>
        {error ?? (blocked
          ? "Avatar changes are unavailable in this state."
          : pending ? "Saving avatar…" : AVATAR_HINT)}
      </span>
    </div>
  );
}
