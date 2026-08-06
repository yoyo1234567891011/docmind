"use client";



import { useState } from "react";



import { Button } from "@/components/ui";
import { CheckIcon, CopyIcon } from "@/components/ui/icons";

import { LETTER_TYPE_LABELS, type ReadyReply } from "@/types";



interface ReadyReplyCardProps {

  reply: ReadyReply;

}



export function ReadyReplyCard({ reply }: ReadyReplyCardProps) {

  const [copied, setCopied] = useState(false);



  if (!reply.required) {

    return (

      <section className="animate-fade-up surface-panel rounded-2xl px-5 py-4 text-left">

        <h3 className="font-display text-xl text-[var(--foreground)]">

          Courrier

        </h3>

        <p className="mt-2 text-sm text-[var(--muted)]">{reply.reason}</p>

      </section>

    );

  }



  const fullLetter = reply.subject

    ? `Objet : ${reply.subject}\n\n${reply.body}`

    : reply.body;



  const handleCopy = async () => {

    try {

      await navigator.clipboard.writeText(fullLetter);

      setCopied(true);

      window.setTimeout(() => setCopied(false), 2000);

    } catch {

      setCopied(false);

    }

  };



  return (

    <section className="animate-fade-up surface-panel rounded-2xl text-left">

      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--border)] px-5 py-4">

        <div>

          <h3 className="font-display text-xl text-[var(--foreground)]">

            Courrier prêt à envoyer

          </h3>

          <p className="mt-1 text-sm text-[var(--muted)]">{reply.reason}</p>

          <div className="mt-2 flex flex-wrap gap-2 text-xs text-[var(--muted)]">

            {reply.letterType ? (

              <span className="rounded-md bg-[var(--accent-soft)] px-2 py-0.5 text-[var(--accent)]">

                {LETTER_TYPE_LABELS[reply.letterType]}

              </span>

            ) : null}

            {reply.recipient ? (

              <span className="rounded-md border border-[var(--border)] px-2 py-0.5">

                Destinataire : {reply.recipient}

              </span>

            ) : null}

          </div>

        </div>

        <Button variant="secondary" onClick={() => void handleCopy()}>

          {copied ? (

            <>

              <CheckIcon className="h-4 w-4" />

              Copié

            </>

          ) : (

            <>

              <CopyIcon className="h-4 w-4" />

              Copier le courrier

            </>

          )}

        </Button>

      </header>



      <div className="space-y-4 px-5 py-4">

        {reply.subject ? (

          <div>

            <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-[var(--muted)]">

              Objet

            </p>

            <p className="mt-1 text-sm font-medium text-[var(--foreground)]">

              {reply.subject}

            </p>

          </div>

        ) : null}



        <div className="rounded-xl bg-[var(--background)] px-4 py-4">

          <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-[var(--foreground)]">

            {reply.body}

          </pre>

        </div>



        {reply.factsUsed && reply.factsUsed.length > 0 ? (

          <div>

            <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-[var(--muted)]">

              Infos extraites utilisées

            </p>

            <ul className="mt-2 flex flex-wrap gap-2">

              {reply.factsUsed.slice(0, 8).map((fact) => (

                <li

                  key={fact}

                  className="rounded-md border border-[var(--border)] px-2 py-1 text-xs text-[var(--muted)]"

                >

                  {fact}

                </li>

              ))}

            </ul>

          </div>

        ) : null}

      </div>

    </section>

  );

}


