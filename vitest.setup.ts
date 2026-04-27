// Defaults seguros para o ambiente de testes. CI define os reais via
// workflow env e ganha precedência (só preenchemos quando ausente).
if (!process.env.ENCRYPTION_KEY) {
  process.env.ENCRYPTION_KEY = "0".repeat(64);
}
