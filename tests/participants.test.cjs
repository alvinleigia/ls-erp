/* eslint-disable @typescript-eslint/no-require-imports */
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { buildParticipantSnapshot } = require('../platform/participants/snapshot.ts')
const { participantSelectionsSchema, participantSnapshotSchema } = require('../platform/participants/validation.ts')
const { quotationSaveSchema, emptyQuotationContent } = require('../modules/sales-documents/quotation-validation.ts')

const person = (id, values = {}) => ({ tenantId: 'tenant-a', kind: 'PERSON', id, name: `Person ${id}`, email: null, phone: null, sourceVersion: 1, ...values })
const select = (party, role = 'CUSTOMER') => ({ role, party: { kind: party.kind, id: party.id } })
const snapshot = (rows, parties) => buildParticipantSnapshot('tenant-a', rows, parties)

test('one transaction supports a main customer and several additional participants', () => {
  const parties = ['a', 'b', 'c', 'd'].map(id => person(id))
  const result = snapshot(parties.map((p, i) => select(p, i ? 'ADDITIONAL_CUSTOMER' : 'CUSTOMER')), parties)
  assert.equal(result.participants.length, 4)
  assert.deepEqual(result.participants.map(p => p.party.id), ['a', 'b', 'c', 'd'])
  assert.equal(participantSnapshotSchema.safeParse(result).success, true)
})

test('a business customer can have multiple named representatives', () => {
  const business = person('company', { kind: 'BUSINESS', name: 'Customer company' })
  const first = person('p1'), second = person('p2')
  const result = snapshot([select(business), select(first, 'REPRESENTATIVE'), select(second, 'REPRESENTATIVE')], [business, first, second])
  assert.deepEqual(result.participants.map(p => [p.role, p.party.kind]), [
    ['CUSTOMER', 'BUSINESS'], ['REPRESENTATIVE', 'PERSON'], ['REPRESENTATIVE', 'PERSON'],
  ])
  assert.equal(JSON.stringify(result).includes('ownership'), false)
})

test('shared email and phone do not merge two distinct people', () => {
  const parties = ['a', 'b'].map(id => person(id, { email: 'family@example.test', phone: '+910000000000' }))
  const result = snapshot([select(parties[0]), select(parties[1], 'ADDITIONAL_CUSTOMER')], parties)
  assert.notEqual(result.participants[0].party.id, result.participants[1].party.id)
  assert.equal(result.participants[0].party.email, result.participants[1].party.email)
})

test('roles belong to the transaction and do not alter reusable identities', () => {
  const a = person('a'), b = person('b')
  const first = snapshot([select(a), select(b, 'ADDITIONAL_CUSTOMER')], [a, b])
  const second = snapshot([select(b), select(a, 'REPRESENTATIVE')], [a, b])
  assert.equal(first.participants[0].party.id, second.participants[1].party.id)
  assert.equal(first.participants[0].role, 'CUSTOMER')
  assert.equal(second.participants[1].role, 'REPRESENTATIVE')
  assert.equal('role' in a, false)
})

test('later master-data changes cannot rewrite a previously built snapshot', () => {
  const source = person('a', { name: 'Accepted name', sourceVersion: 2 })
  const chosen = select(source)
  const saved = snapshot([chosen], [source])
  source.name = 'Changed name'; source.sourceVersion = 3; chosen.role = 'REPRESENTATIVE'
  assert.equal(saved.participants[0].party.name, 'Accepted name')
  assert.equal(saved.participants[0].party.sourceVersion, 2)
  assert.equal(saved.participants[0].role, 'CUSTOMER')
  assert.equal('tenantId' in saved.participants[0].party, false)
})

test('a party can hold separate explicit roles without duplicating its source record', () => {
  const a = person('a')
  const saved = snapshot([select(a), select(a, 'REPRESENTATIVE')], [a])
  assert.equal(saved.participants.length, 2)
  assert.throws(() => snapshot([select(a), select(a)], [a]), /already has that role/)
})

test('transactions require exactly one main customer', () => {
  const a = person('a'), b = person('b')
  assert.equal(participantSelectionsSchema.safeParse([]).success, false)
  assert.throws(() => snapshot([select(a, 'ADDITIONAL_CUSTOMER')], [a]), /exactly one/)
  assert.throws(() => snapshot([select(a), select(b)], [a, b]), /exactly one/)
})

test('foreign-tenant source evidence is rejected even for the same selected ID', () => {
  const a = person('a')
  assert.throws(() => snapshot([select(a)], [{ ...a, tenantId: 'tenant-b' }]), e => e.status === 409)
})

test('missing, unexpected and ambiguous source records fail closed', () => {
  const a = person('a'), b = person('b')
  for (const resolved of [[], [b], [a, b], [a, { ...a, name: 'Conflicting version' }]]) {
    assert.throws(() => snapshot([select(a)], resolved), e => e.status === 409)
  }
})

test('person and business identifiers remain different identities', () => {
  const a = person('same-id'), business = person('same-id', { kind: 'BUSINESS' })
  const saved = snapshot([select(business), select(a, 'REPRESENTATIVE')], [business, a])
  assert.equal(saved.participants.length, 2)
  assert.notEqual(saved.participants[0].party.kind, saved.participants[1].party.kind)
})

test('saved source spelling and communication values are preserved without normalization', () => {
  const source = person('a', { name: '  Customer Name  ', email: 'Family@Example.test', phone: '+91 000 000 0000' })
  const saved = snapshot([select(source)], [source]).participants[0].party
  assert.equal(saved.name, source.name); assert.equal(saved.email, source.email); assert.equal(saved.phone, source.phone)
  assert.throws(() => snapshot([select(source)], [{ ...source, name: '   ' }]))
})

test('unknown roles and security, ownership or payment fields cannot enter participant rows', () => {
  const a = person('a')
  for (const row of [
    { ...select(a), role: 'ADMIN' }, { ...select(a), ownershipPercent: 50 },
    { ...select(a), permissions: ['salesOrders.confirm'] }, { ...select(a), liableAmount: '100' },
  ]) assert.equal(participantSelectionsSchema.safeParse([row]).success, false)
  assert.throws(() => snapshot([select(a)], [{ ...a, secretKey: 'not-for-document' }]))
})

test('snapshot versions, party versions and collection sizes are bounded', () => {
  const a = person('a')
  const valid = snapshot([select(a)], [a])
  assert.equal(participantSnapshotSchema.safeParse({ ...valid, format: 2 }).success, false)
  assert.throws(() => snapshot([select(a)], [{ ...a, sourceVersion: 0 }]))
  const parties = Array.from({ length: 101 }, (_, i) => person(String(i)))
  assert.throws(() => snapshot(parties.map((p, i) => select(p, i ? 'ADDITIONAL_CUSTOMER' : 'CUSTOMER')), parties))
})

test('quotation requests cannot submit server participant snapshots', () => {
  const content = { ...structuredClone(emptyQuotationContent), supplierName: 'Supplier', lines: [{ description: 'Service', quantity: '1', unit: 'hour', rate: '10' }] }
  const a = person('a'), participants = snapshot([select(a)], [a])
  assert.equal(quotationSaveSchema.safeParse({ content }).success, true)
  assert.equal(quotationSaveSchema.safeParse({ content, participants }).success, false)
  assert.equal(quotationSaveSchema.safeParse({ content: { ...content, participants } }).success, false)
})
