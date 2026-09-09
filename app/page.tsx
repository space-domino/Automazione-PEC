import { redirect } from "next/navigation";

// La root rimanda alla dashboard; il middleware devia a /login se non autenticato.
export default function Home() {
  redirect("/dashboard");
}
