# TypeScript in a React codebase

The job is TypeScript and React together, and "how would you type this
component?" comes up in almost every React interview. The TypeScript track
teaches the type system without a framework. This guide applies it to props,
events, refs, reducers, context and API data, using the React 19 types
(`@types/react` 19).

## Typing props

```tsx
type OrderRowProps = {
  order: Order;
  selected?: boolean;
  onSelect: (id: string) => void;
  children?: React.ReactNode;
};

function OrderRow({ order, selected = false, onSelect, children }: OrderRowProps) {
  return <tr className={selected ? 'selected' : undefined} onClick={() => onSelect(order.id)}>{children}</tr>;
}
```

- **`type` or `interface`?** Either works for props. `interface` can be
  extended and merged; `type` can express unions, which props often need (see
  below). Most teams pick one and stay consistent. `type` is the common default
  because of unions.
- **`children: React.ReactNode`** accepts anything renderable: elements,
  strings, numbers, arrays, `null`. Use `React.ReactElement` only if you
  genuinely need a single element.
- **`React.FC` fell out of favour.** It used to add `children` implicitly, and it
  can't express a generic component. A plain function with typed props is the
  norm. Return types are inferred; you rarely need to write them.

## Events and handlers

Inline handlers infer their event type. Handlers defined separately need it
spelled out:

```tsx
function onChange(e: React.ChangeEvent<HTMLInputElement>) {
  setQuery(e.target.value);
}
function onSubmit(e: React.FormEvent<HTMLFormElement>) {
  e.preventDefault();
  const data = new FormData(e.currentTarget);
}
```

The type parameter is the element the handler is attached to, so
`e.currentTarget` is always that element. `e.target` is only typed that
precisely on `ChangeEvent`; on other events it could be a child element, so it
is a plain `EventTarget`. For callback props, type what the parent cares about, not the
event: `onSelect: (id: string) => void` is better than
`onClick: (e: React.MouseEvent) => void`, because the parent shouldn't need to
dig the id out of a DOM event.

## State and reducers

`useState` infers from its initial value. Annotate when the initial value
doesn't show the full type:

```tsx
const [order, setOrder] = useState<Order | null>(null);
const [status, setStatus] = useState<'idle' | 'saving' | 'error'>('idle');
```

For reducers, a discriminated union of actions makes each payload checked
against its `type`, as [ts/32](../../typescript/32-typed-actions/) builds:

```tsx
type Action =
  | { type: 'added'; line: OrderLine }
  | { type: 'removed'; id: string }
  | { type: 'cleared' };

function reducer(state: OrderLine[], action: Action): OrderLine[] {
  switch (action.type) {
    case 'added': return [...state, action.line];
    case 'removed': return state.filter((l) => l.id !== action.id);
    case 'cleared': return [];
    default: { const never: never = action; return never; }
  }
}
```

Inside each `case`, TypeScript narrows `action`, so `action.line` only exists
under `'added'`. The `never` line makes adding a new action a compile error
until it's handled.

## Refs

```tsx
const inputRef = useRef<HTMLInputElement>(null);
inputRef.current?.focus();
```

In `@types/react` 19, `useRef` **requires an argument**; `useRef<T>()` with no
argument is a type error. `useRef<HTMLInputElement>(null)` returns a
`RefObject<HTMLInputElement | null>`, so you null-check before use. The old
distinction between `RefObject` and `MutableRefObject` has gone: all refs are
mutable. For a value that isn't a DOM node (a timer id), pass the initial value:
`useRef<number | undefined>(undefined)`.

React 19 passes `ref` as an ordinary prop, so a component that exposes its input
just accepts it. `ComponentProps<'input'>` already includes `ref`:

```tsx
function TextField({ ref, ...rest }: React.ComponentProps<'input'>) {
  return <input ref={ref} {...rest} />;
}
```

`forwardRef` and its awkward generics are no longer needed.

## Extending native elements

A `Button` that accepts every `<button>` prop plus its own:

```tsx
type ButtonProps = React.ComponentProps<'button'> & {
  variant?: 'primary' | 'secondary';
};

function Button({ variant = 'primary', type = 'button', className, ...rest }: ButtonProps) {
  return <button type={type} className={`btn btn-${variant} ${className ?? ''}`} {...rest} />;
}
```

Consumers get `onClick`, `disabled`, `aria-*` and the rest with full checking.
Use `Omit<React.ComponentProps<'input'>, 'size'>` when your prop has the same
name as a native one with a different type. Destructure the props you handle and
spread the rest. Order matters: anything you set *after* `{...rest}` can't be
overridden by the caller, and anything before it can.

## Discriminated props

Props that only make sense together should be typed that way, so invalid
combinations don't compile. [ts/30](../../typescript/30-impossible-states/)
applies this to state; the same works for props:

```tsx
type LinkOrButton =
  | { as: 'link'; href: string; onClick?: never }
  | { as: 'button'; onClick: () => void; href?: never };
```

For `function Action(props: LinkOrButton)`, `<Action as="link" onClick={…} />`
is a compile error. The `?: never`
fields stop a caller passing both.

## Generic components

A table that works for any row type, with column accessors checked against it:

```tsx
type Column<Row> = { header: string; cell: (row: Row) => React.ReactNode };

function Table<Row extends { id: string }>({ rows, columns }: { rows: Row[]; columns: Column<Row>[] }) {
  return (
    <table>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id}>{columns.map((c) => <td key={c.header}>{c.cell(r)}</td>)}</tr>
        ))}
      </tbody>
    </table>
  );
}

<Table rows={orders} columns={[{ header: 'Total', cell: (o) => o.total }]} />;
```

`Row` is inferred from `rows`, so `o` in the column is an `Order`. In a `.tsx`
file, a generic arrow function needs `<Row,>` to avoid being parsed as JSX,
which is one reason to use `function` declarations for components.

Generics are worth it for reusable table, select and list components in a
design system. For a component used in one place with one type, they're
overkill: type it concretely.

## Context and API data

Context with a `null` default and a guard hook, so consumers never deal with
`null`:

```tsx
const AuthContext = createContext<AuthState | null>(null);

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
```

**API data is not typed until you check it.** `await res.json()` returns
`any`, and `as Order[]` is a promise to the compiler that nothing verifies.
Validate at the boundary with a schema and derive the type from it, as
[ts/43](../../typescript/43-schema-infer/) does:

```ts
import { z } from 'zod';

const Order = z.object({ id: z.string(), total: z.number(), status: z.enum(['open', 'paid']) });
type Order = z.infer<typeof Order>;

const orders = z.array(Order).parse(await res.json());   // throws on a mismatch
```

Static types protect you inside your code; runtime validation protects the
edges, where data arrives from the network, `localStorage` or a form. One
schema gives you both.

## tsconfig for React

```json
{
  "compilerOptions": {
    "target": "es2022",
    "module": "esnext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "verbatimModuleSyntax": true,
    "noEmit": true
  }
}
```

- **`module: esnext` + `moduleResolution: bundler`** go together; `bundler` is
  rejected unless `module` is `preserve` or ES2015+, so leaving `module` out is a
  config error, not a default.
- **`jsx: react-jsx`** uses the automatic runtime, so you don't `import React`
  in every file.
- **`strict`** is non-negotiable in new code.
- **`noUncheckedIndexedAccess`** makes `rows[0]` type `Row | undefined`. It
  catches real bugs; DevPath's own app has it on.
- **`verbatimModuleSyntax`** requires `import type` for type-only imports, so
  the bundler, which strips types file by file without checking them, knows
  what to drop.
- **`noEmit`**: Vite transpiles, and `tsc` only type-checks.

React 19's types moved the global `JSX` namespace to **`React.JSX`**, so older
code using `JSX.Element` needs updating. TypeScript 7, the native compiler
rewritten in Go, is about speed, roughly ten times faster type-checking, not
new semantics. Code that compiles cleanly on 5.9 with no deprecated options is
ready for it.

## What you should be able to answer

- How do you type a component that accepts every `<button>` prop plus one of its
  own?
- How do you type a reducer so each action's payload is checked?
- How would you write a generic `Table` component, and when is it overkill?
- Where do runtime validation and static types meet?
- What changed about `useRef` and `forwardRef` in React 19's types?
