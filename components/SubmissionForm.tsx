"use client";
import { FormEvent, useState } from "react";
export function SubmissionForm() {
  const [message, setMessage] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); setMessage("Submitting…"); const form=event.currentTarget; const response=await fetch("/api/submissions",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(Object.fromEntries(new FormData(form)))}); const result=await response.json(); setMessage(response.ok?`Received for review (${result.reference}).`:result.error||"Submission failed."); if(response.ok) form.reset(); }
  return <form className="submissionForm" onSubmit={submit}><label>Festival name<input name="name" required minLength={2} maxLength={100}/></label><label>Official source URL<input name="officialUrl" type="url" required/></label><label>Edition year<input name="year" type="number" min="2027" max="2100" required/></label><label>Notes<textarea name="notes" maxLength={1000}/></label><input className="honeypot" name="website" tabIndex={-1} autoComplete="off" aria-hidden="true"/><button type="submit">Send for editorial review</button><p role="status" aria-live="polite">{message}</p></form>;
}
