import { replySalonInstagram } from "@/lib/instagram-inbox/rep-actions";
import { instagramReplyAllowed } from "@/lib/instagram-inbox/security";
import { frenchDate } from "@/lib/crm-format";
import { SubmitButton } from "@/components/SubmitButton";

type ConversationItem = {
  id: string;
  username: string | null;
  lastInboundAt: Date | null;
  messages: Array<{
    id: string;
    incoming: boolean;
    text: string;
    sentAt: Date;
    sentByUser?: { name: string | null; email: string | null } | null;
  }>;
};

export function SalonInstagramPanel({
  salonId,
  conversations,
  error,
}: {
  salonId: string;
  conversations: ConversationItem[];
  error?: string;
}) {
  return (
    <div className="rounded-xl border border-slate-300 bg-white p-5 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">Messages Instagram</h2>
          <p className="text-xs text-slate-500">Conversations liées à ce salon (réponse directe dans la fenêtre Meta 24 h).</p>
        </div>
      </div>

      {error && <p className="mb-3 rounded-lg bg-rose-50 p-2.5 text-xs text-rose-700">{error}</p>}

      {conversations.length === 0 ? (
        <p className="text-sm text-slate-400">Aucune conversation Instagram rattachée à ce salon.</p>
      ) : (
        <div className="space-y-4">
          {conversations.map((conv) => {
            const canReply = instagramReplyAllowed(conv.lastInboundAt);
            return (
              <div key={conv.id} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <div className="mb-2 flex items-center justify-between text-xs">
                  <span className="font-semibold text-violet-700">{conv.username ? `@${conv.username}` : "Fil Instagram"}</span>
                  <span className={canReply ? "text-emerald-700" : "text-slate-400"}>
                    {canReply ? "Fenêtre 24 h ouverte" : "Fenêtre 24 h fermée"}
                  </span>
                </div>
                <div className="max-h-60 space-y-2 overflow-y-auto pr-1">
                  {conv.messages.map((m) => (
                    <div
                      key={m.id}
                      className={`rounded-lg px-3 py-2 text-xs ${
                        m.incoming ? "mr-6 bg-white text-slate-800 ring-1 ring-slate-200" : "ml-6 bg-violet-600 text-white"
                      }`}
                    >
                      <p className="whitespace-pre-wrap">{m.text}</p>
                      <p className={`mt-1 text-[10px] ${m.incoming ? "text-slate-400" : "text-violet-100"}`}>
                        {frenchDate(m.sentAt, true)}
                        {!m.incoming && m.sentByUser ? ` · ${m.sentByUser.name ?? m.sentByUser.email}` : ""}
                      </p>
                    </div>
                  ))}
                </div>
                {canReply && (
                  <form action={replySalonInstagram} className="mt-3 flex gap-2">
                    <input type="hidden" name="salonId" value={salonId} />
                    <input type="hidden" name="conversationId" value={conv.id} />
                    <input
                      name="text"
                      required
                      maxLength={1000}
                      placeholder="Répondre sur Instagram…"
                      className="h-9 flex-1 rounded-lg border border-slate-300 bg-white px-3 text-xs text-slate-900"
                    />
                    <SubmitButton className="rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-violet-700">
                      Envoyer
                    </SubmitButton>
                  </form>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
