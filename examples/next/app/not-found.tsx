import Link from "next/link";

export default function NotFoundPage() {
  return (
    <main className="home" id="main-content" tabIndex={-1}>
      <div className="home-intro">
        <h1>Guide not found.</h1>
        <p>This guide is unavailable. Browse the documentation to find what you need.</p>
        <p>
          <Link href="/">Back to the guides</Link>
        </p>
      </div>
    </main>
  );
}
