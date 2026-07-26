// data — shared date-comparison utilities for the domain/services layer.
//
// `mesmoDia` compares two dates by calendar day (year/month/day) using
// the server's local time zone, ignoring hour/minute/second. Originally
// defined in AtividadesFinalizadasService, extracted here so every
// service that needs "same calendar day" semantics (e.g.
// AtividadesFinalizadasService.finalizadaHoje, ListaDeAcordosService's
// Lista_de_Acordos_Nao_Atualizados) shares a single definition.

/** Compares two dates by calendar day (year/month/day) in the server's local time zone. */
export function mesmoDia(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}
