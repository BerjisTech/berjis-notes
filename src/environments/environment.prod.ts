const w = typeof window !== 'undefined' ? (window as any) : {};

export const environment = {
  production: true,
  apiBase: w && typeof w.__BERJIS_API__ === 'string' && w.__BERJIS_API__.trim().length
    ? w.__BERJIS_API__.trim()
    : 'https://api.berjis.tech',
  notesApiBase: w && typeof w.__NOTES_API__ === 'string' && w.__NOTES_API__.trim().length
    ? w.__NOTES_API__.trim()
    : 'https://notes-api.berjis.tech'
};
