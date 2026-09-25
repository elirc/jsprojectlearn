# Prototypes and classes

JavaScript classes look like Java or C# classes, but underneath they are
objects linked to other objects. Interviewers ask "how does inheritance work in
JavaScript?" to find out whether you know that — because it explains why
methods vanish when you spread an instance, why `JSON.parse` never gives you a
`User`, and why a field can be `undefined` inside a base constructor.

## Every object has a prototype

Each object has a hidden link, `[[Prototype]]`, to another object (or `null`).
When you read a property, the engine looks on the object itself, then on its
prototype, then on that object's prototype, and so on until it reaches `null`.
That chain is the whole inheritance model.

```js
const defaults = { currency: 'GBP', locale: 'en-GB' };
const order = Object.create(defaults); // order's prototype is defaults
order.currency = 'EUR';                // own property shadows the inherited one

console.log(order.currency, order.locale);          // EUR en-GB
console.log(Object.hasOwn(order, 'locale'));        // false: inherited
delete order.currency;
console.log(order.currency);                        // GBP: lookup falls back again
```

Three rules follow from this:

- **Reads** walk the chain. **Writes** always create or change an *own*
  property (unless a setter is inherited).
- `delete` only removes own properties; it never walks up.
- `for...in` includes inherited enumerable keys; `Object.keys`,
  `Object.entries`, spread and `JSON.stringify` see own properties only.

`Object.getPrototypeOf(obj)` reads the link. `obj.__proto__` is a legacy
accessor for the same thing; do not use it in new code.

## Constructor functions: what `class` replaced

Before 2015 you built "classes" by hand. Every function has a `prototype`
object, and `new` links the new instance to it:

```js
function Account(owner) {
  this.owner = owner;
}
Account.prototype.describe = function () {
  return `Account of ${this.owner}`;
};

const a = new Account('Ada');
const b = new Account('Grace');
console.log(a.describe(), a.describe === b.describe); // Account of Ada true
console.log(Object.getPrototypeOf(a) === Account.prototype); // true
```

`new Account('Ada')` does four things: creates an empty object, sets its
prototype to `Account.prototype`, runs `Account` with `this` bound to it, and
returns it. Methods live once on the prototype and are shared, which is why
`a.describe === b.describe`.

## `class` is mostly the same thing, with guard rails

```js
class Account {
  constructor(owner) { this.owner = owner; }
  describe() { return `Account of ${this.owner}`; }
}

console.log(typeof Account); // function
console.log(Object.getOwnPropertyNames(Account.prototype)); // [ 'constructor', 'describe' ]
```

A class is still a function with a `prototype` object. What `class` adds:

| Feature | Constructor function | `class` |
|---------|----------------------|---------|
| Calling without `new` | runs, `this` is wrong | throws a TypeError |
| Strict mode | opt in | always |
| Methods enumerable | yes (assigned) | no |
| Hoisting | declaration hoisted | TDZ, like `let` |
| Fields, `#private`, `static` blocks | not available | built in |
| `super` | manual `Parent.call(this)` | `super()` / `super.method()` |

Non-enumerable methods matter: `for...in` over an instance shows only its data,
and spreading or JSON-serialising an instance never includes methods.

## Fields and private state

Class fields are created on **each instance** when it is constructed, not on
the prototype. Private `#fields` are not properties at all: they are invisible
to `Object.keys`, `JSON.stringify` and `in` (except `#field in obj`), and
reading one from the wrong object throws.

```js
class Money {
  #pence;
  constructor(pence) { this.#pence = pence; }
  get pounds() { return this.#pence / 100; }
  plus(other) { return new Money(this.#pence + other.#pence); }
  toJSON() { return { pence: this.#pence }; }
}

const total = new Money(250).plus(new Money(199));
console.log(total.pounds, Object.keys(total), JSON.stringify(total)); // 4.49 [] {"pence":449}
try {
  total.plus({ pence: 1 });
} catch (e) {
  console.log(e.name); // TypeError: the object has no #pence
}
```

That last behaviour is useful: `#private` gives you a brand check for free,
something closures and underscore-prefixed names cannot.

## Inheritance and `super`

`extends` builds two prototype chains: instances inherit through
`Admin.prototype → User.prototype`, and the class itself inherits from its
parent, which is how `static` methods are inherited.

```js
class User {
  static create(name) { return new this(name); }
  constructor(name) { this.name = name; }
  describe() { return this.name; }
}
class Admin extends User {
  describe() { return `${super.describe()} (admin)`; }
}

const admin = Admin.create('Ada');
console.log(admin.describe(), admin instanceof User); // Ada (admin) true
console.log(Object.getPrototypeOf(Admin) === User);   // true
```

Two ordering rules catch people out:

1. In a subclass constructor, `this` does not exist until `super()` returns.
   Reading or writing `this` first throws a `ReferenceError`.
2. Subclass **fields** are initialised right after `super()` returns, so a base
   constructor that reads an overridden field sees `undefined`.

```js
class Base {
  constructor() { this.label = `type=${this.type}`; }
}
class Order extends Base {
  type = 'order';
}
console.log(new Order().label); // type=undefined
```

## `instanceof` and plain data

`x instanceof C` asks "is `C.prototype` anywhere on `x`'s chain?" It knows
nothing about shape. That has three practical consequences:

```js
class User { get label() { return `#${this.id}`; } }

const fromApi = JSON.parse('{"id": 7}');
console.log(fromApi instanceof User, fromApi.label); // false undefined

const copied = { ...Object.assign(new User(), { id: 7 }) };
console.log(copied instanceof User, copied.label);   // false undefined

const hydrated = Object.assign(new User(), fromApi);
console.log(hydrated instanceof User, hydrated.label); // true #7
```

- `JSON.parse`, `structuredClone` and object spread all produce **plain
  objects**. Behaviour does not survive serialisation or copying. A TypeScript
  annotation `as User` changes nothing at runtime.
- `instanceof` fails across realms (iframes, Node `vm`), which is why
  `Array.isArray` and `Error.isError` exist.
- If you need methods back, construct deliberately: a `static fromJSON(data)`
  or `Object.assign(new User(), data)`.

## Composition over deep hierarchies

Inheritance is fine for genuine "is-a" relationships with a stable base: custom
error types (`class NotFoundError extends Error`), framework base classes, a
small abstract repository. It goes wrong when you use it to share code:
`Person → User → AdminUser → SuperAdminUser` ends with every subclass
depending on its parents' internals, and a flag on the base that only one
subclass uses.

For CRUD code, prefer **composition**: small objects or functions passed in.

```js
const canEdit = (user, doc) => user.role === 'admin' || doc.ownerId === user.id;

function createDocumentService({ repo, policy }) {
  return {
    rename(user, doc, title) {
      if (!policy(user, doc)) throw new Error('Forbidden');
      return repo.save({ ...doc, title });
    },
  };
}

const service = createDocumentService({ repo: { save: (d) => d }, policy: canEdit });
console.log(service.rename({ id: 1, role: 'user' }, { ownerId: 1, title: 'a' }, 'b').title); // b
```

Swapping the policy or the repository in a test needs no subclass. The same
idea is dependency injection in ASP.NET Core — see
[dependency injection explained](dependency-injection-explained.md). For the
`this` rules that classes rely on, see [this and binding](this-and-binding.md).

## What you should be able to answer

- How does property lookup work in JavaScript, and what happens on a write or a
  `delete`?
- What does `new` do, step by step, and what is `class` actually compiled to?
- Name three things `class` gives you that constructor functions do not.
- Why is a subclass field `undefined` inside the base constructor?
- Why does `JSON.parse(text) instanceof User` return false, and how do you get a
  real instance back?
- When is inheritance the right tool in application code, and when would you
  compose instead?
