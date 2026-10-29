import { listIdeas, listProducts } from "@/lib/factory";
import CreateForm from "./CreateForm";

export const dynamic = "force-dynamic";

export default async function FactoryDashboard() {
  const [products, ideas] = await Promise.all([listProducts(), listIdeas()]);

  return (
    <main className="mx-auto max-w-6xl px-4 py-10">
      <header className="mb-10">
        <p className="text-sm font-semibold uppercase tracking-widest text-emerald-400">
          Micro-SaaS Factory
        </p>
        <h1 className="mt-2 text-4xl font-bold tracking-tight text-white">
          Ship a product in one call
        </h1>
        <p className="mt-3 max-w-2xl text-slate-400">
          The factory clones <code className="rounded bg-slate-800 px-1 py-0.5">templates/micro-saas-template</code>,
          replaces every token with your product details, and drops a ready-to-build
          app into <code className="rounded bg-slate-800 px-1 py-0.5">products/</code>.
        </p>
      </header>

      <section className="mb-12 grid gap-4 sm:grid-cols-3">
        <Stat label="Products built" value={products.length} />
        <Stat label="Ideas in backlog" value={ideas.length} />
        <Stat label="API routes" value={3} />
      </section>

      <section className="mb-12">
        <h2 className="mb-4 text-xl font-semibold text-white">Create a product</h2>
        <CreateForm />
        <p className="mt-3 text-sm text-slate-500">
          Or call the API directly:
        </p>
        <pre className="mt-2 overflow-x-auto rounded-lg bg-slate-900 p-4 text-sm text-slate-300">{`curl -X POST http://localhost:3000/api/factory/create \\
  -H 'Content-Type: application/json' \\
  -d '{"name":"Tip Calculator","problem":"Splitting bills is annoying","target":"friends dining out","price":"$9"}'`}</pre>
      </section>

      <section className="mb-12">
        <h2 className="mb-4 text-xl font-semibold text-white">
          Products ({products.length})
        </h2>
        {products.length === 0 ? (
          <p className="rounded-lg border border-dashed border-slate-700 p-6 text-slate-500">
            No products yet. Create the first one above.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-slate-800">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-900 text-slate-400">
                <tr>
                  <th className="px-4 py-3 font-medium">Slug</th>
                  <th className="px-4 py-3 font-medium">Name</th>
                  <th className="px-4 py-3 font-medium">Target</th>
                  <th className="px-4 py-3 font-medium">Price</th>
                  <th className="px-4 py-3 font-medium">Files</th>
                  <th className="px-4 py-3 font-medium">Created</th>
                </tr>
              </thead>
              <tbody>
                {products.map((p) => (
                  <tr key={p.slug} className="border-t border-slate-800">
                    <td className="px-4 py-3 font-mono text-emerald-400">products/{p.slug}</td>
                    <td className="px-4 py-3 text-white">{p.name}</td>
                    <td className="px-4 py-3 text-slate-300">{p.target}</td>
                    <td className="px-4 py-3 text-slate-300">{p.price}</td>
                    <td className="px-4 py-3 text-slate-300">{p.files}</td>
                    <td className="px-4 py-3 text-slate-500">
                      {new Date(p.createdAt).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-4 text-xl font-semibold text-white">
          Idea backlog ({ideas.length})
        </h2>
        <div className="overflow-x-auto rounded-lg border border-slate-800">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-900 text-slate-400">
              <tr>
                <th className="px-4 py-3 font-medium">#</th>
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Problem</th>
                <th className="px-4 py-3 font-medium">Target</th>
                <th className="px-4 py-3 font-medium">Price</th>
              </tr>
            </thead>
            <tbody>
              {ideas.map((idea) => (
                <tr key={idea.id} className="border-t border-slate-800">
                  <td className="px-4 py-3 text-slate-500">{idea.id}</td>
                  <td className="px-4 py-3 text-white">{idea.name}</td>
                  <td className="px-4 py-3 text-slate-300">{idea.problem}</td>
                  <td className="px-4 py-3 text-slate-300">{idea.target}</td>
                  <td className="px-4 py-3 text-emerald-400">{idea.price}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-5">
      <p className="text-sm text-slate-400">{label}</p>
      <p className="mt-1 text-3xl font-bold text-white">{value}</p>
    </div>
  );
}
