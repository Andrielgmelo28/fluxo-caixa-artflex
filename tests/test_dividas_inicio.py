"""Coluna opcional `inicio` do dividas.csv: data da 1a parcela (fim da carencia).

Antes dela nao sai parcela nenhuma. Exemplo FICTICIO: SAC de R$ 330.000, juros de
1% a.m., amortizacao de R$ 10.000 no dia 30, 1a parcela em 28/02/2027. Sem a regra,
o fluxo de caixa ja cobraria R$ 10.000 + juros em 30/11/2026."""
import datetime
import os
import sys
import tempfile
import unittest
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import build  # noqa: E402


class FakeDate(datetime.date):
    @classmethod
    def today(cls):
        return cls(2026, 11, 17)


def divida(**kw):
    d = {"op": "X", "e": "Empresa Teste", "g": "Teste", "banco": "Banco Teste", "produto": "Linha rotativa",
         "tipo": "sac", "saldo": 330000.0, "taxa": 1.0, "cap": 10000.0, "dia": 30,
         "fim": "2029-10-30", "obs": "", "face": None, "liquido": None, "recompra": None,
         "taxa_capa": None}
    d.update(kw)
    return d


class TestInicio(unittest.TestCase):
    def projeta(self, d, meses=6):
        with mock.patch.object(build.datetime, "date", FakeDate):
            return build.projetar_parcelas([d], ate_meses=meses)

    def test_sem_parcela_antes_do_inicio(self):
        p = self.projeta(divida(inicio="2027-02-28"))
        self.assertTrue(p, "deveria haver parcelas a partir de 28/02/2027")
        self.assertEqual(p[0]["d"], "2027-02-28")
        self.assertTrue(all(x["d"] >= "2027-02-28" for x in p))
        # 1a parcela: amortizacao 10.000 + juros de 1% sobre 330.000 = 3.300
        self.assertAlmostEqual(p[0]["v"], 13300.00, places=2)

    def test_sem_inicio_continua_como_antes(self):
        p = self.projeta(divida())
        self.assertEqual(p[0]["d"], "2026-11-30")

    def test_ler_dividas_le_a_coluna_inicio(self):
        cab = "operacao;empresa;banco;produto;tipo;saldo;taxa_am;capital_mes;dia;fim;obs;face;liquido;recompra;taxa_capa;inicio\n"
        lin = "Y;Empresa Teste;Banco Teste;Linha rotativa;sac;330000.00;1.00;10000.00;30;2029-10-30;ficticio;;;;;2027-02-28\n"
        with tempfile.TemporaryDirectory() as tmp:
            with open(os.path.join(tmp, "dividas.csv"), "w", encoding="utf-8") as f:
                f.write(cab + lin)
            with mock.patch.object(build, "cfg", lambda nome: os.path.join(tmp, nome)):
                dividas, avisos = build.ler_dividas(tmp)
        self.assertEqual(avisos, [])
        self.assertEqual(dividas[0].get("inicio"), "2027-02-28")


if __name__ == "__main__":
    unittest.main()
