import { SubmissionForm } from "@/components/SubmissionForm";
export const metadata = { title: "Submit a festival", description: "Suggest a European rock or metal festival using an official source.", alternates: { canonical: "/submit/" } };
export default function SubmitPage() { return <div className="directoryPage"><p className="eyebrow">COMMUNITY SOURCES</p><h1>Submit a festival</h1><p>Every suggestion is reviewed before publication. Please link only to the festival organizer or an official ticketing partner.</p><SubmissionForm/></div>; }
