"use client";

import { useFormStatus } from "react-dom";

export function SubmitButton({
  children,
  className = "button",
  confirmMessage,
  pendingLabel = "Saving..."
}: {
  children: React.ReactNode;
  className?: string;
  confirmMessage?: string;
  pendingLabel?: string;
}) {
  const { pending } = useFormStatus();

  return (
    <button
      className={className}
      disabled={pending}
      onClick={(event) => {
        if (confirmMessage && !window.confirm(confirmMessage)) event.preventDefault();
      }}
      type="submit"
    >
      {pending ? pendingLabel : children}
    </button>
  );
}
