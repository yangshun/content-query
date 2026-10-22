import { Link, useLoaderData, type MetaFunction } from "react-router";
import { content } from "content-query:server";

export async function loader() {
  return {
    guides: await content
      .select("id", "title", "description")
      .from("guides")
      .orderBy("order")
      .all(),
  };
}

export const meta: MetaFunction = () => [
  { title: "MDX + React islands | ContentQuery" },
  {
    name: "description",
    content: "The same MDX documents rendered as independent islands or one React tree.",
  },
];

export default function IndexPage() {
  const { guides } = useLoaderData<typeof loader>();
  return (
    <main className="index-page">
      <h1>MDX and React islands</h1>
      <p>
        Explore the same MDX in two rendering modes. Islands keep prose as HTML; React mode renders
        the document in the application’s React tree.
      </p>
      <ul className="guide-list">
        {guides.map((guide) => (
          <li key={guide.id}>
            <h2>{guide.title}</h2>
            <p>{guide.description}</p>
            <p>
              <Link to={`/islands/docs/${guide.id}`}>Islands</Link>
              {" · "}
              <Link to={`/react/docs/${guide.id}`}>React</Link>
            </p>
          </li>
        ))}
      </ul>
    </main>
  );
}
