# Composition patterns in React

Most "how would you design this component?" questions are composition
questions in disguise. Interviewers hand you a `Modal`, a `Tabs` or a
`DataTable` that has grown thirty props and ask how you would fix it. A
mid-level answer names the patterns, says what each one costs, and picks the
simplest one that works.

## Start with children, not configuration

The cheapest composition tool is `children`. Anything you put between a
component's tags arrives as the `children` prop, already rendered by the
parent:

```tsx
function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="card">
      <h2>{title}</h2>
      {children}
    </section>
  );
}

<Card title="Billing">
  <BillingForm />
</Card>
```

`Card` knows nothing about billing, so it never needs a `showForm` or
`formType` prop. That is the first question to ask when a component keeps
gaining props: *could the caller just pass the content?*

There is a performance bonus too. `children` elements are created by the
parent, so when `Card` re-renders because of its own state, the `children` it
received are the same element objects and React can skip re-rendering them.
[react/06](../../react/06-children-composition/) builds this up from scratch.

## Slots: more than one hole

When a layout has several holes, pass elements as named props. This is the
"slot" pattern:

```tsx
function PageLayout(props: {
  header: React.ReactNode;
  sidebar?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="page">
      <header>{props.header}</header>
      {props.sidebar && <aside>{props.sidebar}</aside>}
      <main>{props.children}</main>
    </div>
  );
}
```

Slots keep the layout in charge of *where* things go and the caller in charge
of *what* goes there. They beat boolean props such as `showSidebar`, because the
caller can put anything in the sidebar without the layout changing.

## Compound components

Some widgets are a family of parts that share state: tabs, accordions, menus,
selects. Compound components expose the parts and let the caller arrange them:

```tsx
<Tabs defaultValue="profile">
  <Tabs.List>
    <Tabs.Trigger value="profile">Profile</Tabs.Trigger>
    <Tabs.Trigger value="security">Security</Tabs.Trigger>
  </Tabs.List>
  <Tabs.Panel value="profile"><ProfileForm /></Tabs.Panel>
  <Tabs.Panel value="security"><SecurityForm /></Tabs.Panel>
</Tabs>
```

The parent owns the state and shares it through context, and each part reads
what it needs:

```tsx
const TabsContext = createContext<{ value: string; setValue(v: string): void } | null>(null);

function useTabs() {
  const ctx = useContext(TabsContext);
  if (!ctx) throw new Error('Tabs parts must be inside <Tabs>');
  return ctx;
}

function Trigger({ value, children }: { value: string; children: React.ReactNode }) {
  const tabs = useTabs();
  return (
    <button role="tab" aria-selected={tabs.value === value} onClick={() => tabs.setValue(value)}>
      {children}
    </button>
  );
}
```

Older implementations used `React.Children.map` and `cloneElement` to inject
props into direct children. That breaks as soon as someone wraps a trigger in a
`<Tooltip>` or a fragment, because the injected props land on the wrong
element. Context works at any depth, which is why every modern headless library
uses it. [react/35](../../react/35-compound-tabs/) builds compound tabs with the
keyboard behaviour included.

## Render props and custom hooks

A render prop is a function prop that returns UI. The component supplies data;
the caller decides how it looks:

```tsx
<DataList items={orders} renderItem={(order) => <OrderRow order={order} />} />
```

Render props used to be the main way to share *behaviour* (a mouse tracker, a
data fetcher). Hooks replaced most of that: `useMousePosition()` shares the
logic without an extra layer in the tree. Today render props remain the right
tool when a component owns a loop or a layout and the caller customises one
piece of it, as with `renderItem` above or a virtualised list's row renderer.

| Need | Reach for |
|---|---|
| Share logic, caller renders everything | A custom hook |
| Component owns structure, caller customises a piece | A render prop or a slot |
| Several parts that share state | Compound components |
| Fixed layout with holes | `children` and slots |
| Wrap many components with one concern | A hook first; a higher-order component only for legacy code |

## Controlled and uncontrolled APIs

A reusable input-like component should work both ways: the caller either owns
the value (`value` plus `onChange`) or lets the component own it
(`defaultValue`). The conventional implementation checks whether the value prop
is defined:

```tsx
function useControllable<T>(value: T | undefined, defaultValue: T, onChange?: (v: T) => void) {
  const [inner, setInner] = useState(defaultValue);
  const isControlled = value !== undefined;
  const current = isControlled ? value : inner;
  const set = (next: T) => {
    if (!isControlled) setInner(next);
    onChange?.(next);
  };
  return [current, set] as const;
}
```

Two rules follow. Never copy a controlled `value` into local state, because the
copy goes stale when the parent changes it. And never switch between
controlled and uncontrolled during a component's life; React warns about this
for native inputs for the same reason. Name the pair after the thing:
`open`/`onOpenChange`, `value`/`onValueChange`.
[react/36](../../react/36-controlled-component-api/) is the exercise.

## Headless components and `asChild`

A headless component ships behaviour and accessibility (focus, keyboard,
ARIA) with no styling. Radix Primitives, React Aria and Headless UI all work
this way, and it is why design systems in 2026 are usually "headless primitives
plus our own CSS".

Two techniques make headless components flexible:

- **Prop getters.** A hook returns functions such as `getToggleProps()` that
  merge its handlers and ARIA attributes with yours, so you can render any
  element.
- **`asChild` (the Slot pattern).** `<Dialog.Trigger asChild><Link to="/x" /></Dialog.Trigger>`
  tells the trigger to merge its props into its single child instead of
  rendering its own button. You keep your element; the library keeps its
  behaviour.

The polymorphic `as` prop (`<Button as="a" href="/x">`) solves the same
problem but is hard to type well in TypeScript and easy to misuse (a "button"
that renders an `a` with no `href`). `asChild` has largely replaced it in new
libraries; [the TypeScript in React guide](typescript-in-react.md) covers typing
either.

## Refactoring a prop explosion

The classic interview prompt: a `DataTable` with `showFooter`, `compact`,
`hideSearch`, `enableExport`, `exportFormat`, `customEmptyMessage` and twenty
more. The fix is to invert control:

1. Replace content booleans with slots: `footer={<Totals />}` instead of
   `showFooter` plus `footerType`.
2. Replace behaviour flags with composition: render `<TableSearch />` above
   the table if you want search, rather than `hideSearch={false}`.
3. Replace one-off overrides with render props: `renderEmpty={() => ...}`.
4. Keep true configuration (`density: 'compact' | 'comfortable'`) as a small
   union, not a pile of booleans that can contradict each other.

The result has fewer props, no impossible combinations, and features that do
not force changes into the shared component. The trade-off is that callers
write slightly more JSX. That is almost always worth it for shared components,
and almost never worth it for a component used once.

## Pitfalls that show up in code review

- **Defining a component inside another component.** Each render creates a new
  component type, so React unmounts and remounts it and its state resets.
  Define components at module level and pass data as props.
- **Context for everything.** Compound components need context; a prop passed
  one or two levels does not. See [context without the perf trap](react-context-performance.md)
  for what a busy context costs.
- **Leaking internals through `cloneElement`.** If a parent must know the exact
  type and props of its children, the API is fragile. Prefer context or
  explicit props.
- **Spreading props in the wrong order.** In a wrapper, spread `{...rest}`
  before your own handlers and compose them (call yours, then theirs), or the
  caller's `onClick` silently replaces your behaviour.

## What you should be able to answer

- What is prop drilling, and when is passing `children` a better fix than context?
- How do compound components share state, and why is context safer than `cloneElement`?
- When would you still use a render prop in a codebase that has hooks?
- How do you build a component that works both controlled and uncontrolled, and what must you never do?
- What problem do headless libraries and `asChild` solve?
- How would you refactor a component with thirty boolean props?
