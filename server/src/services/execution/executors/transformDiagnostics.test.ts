import { describe, expect, it } from 'vitest';
import { createTransformDiagnostic } from './transformDiagnostics';

describe('transform diagnostics', () => {
  it('finds missing top-level, nested, and array element paths without exposing sensitive keys', () => {
    const top = createTransformDiagnostic('return input.user.body.length', { user: { id: 1, token: 'secret' } }, "Cannot read properties of undefined (reading 'length')");
    expect(top.referencedPath).toBe('input.user.body');
    expect(top.availableFields).toEqual(['id']);
    const nested = createTransformDiagnostic('return input.customer.address.city.length', { customer: { address: {} } }, 'missing');
    expect(nested.referencedPath).toBe('input.customer.address.city');
    const array = createTransformDiagnostic('return input.items[0].price.toFixed()', { items: [{}] }, 'missing');
    expect(array.referencedPath).toBe('input.items.0.price');
  });
  it('preserves the original error and falls back when no referenced path is reliable', () => {
    const diagnostic = createTransformDiagnostic('throw new Error("bad data")', { item: { id: 1 } }, 'bad data');
    expect(diagnostic.originalError).toBe('bad data');
    expect(diagnostic.referencedPath).toBeUndefined();
  });
});
