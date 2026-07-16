ALTER TABLE "target_instrument"
DROP CONSTRAINT "target_instrument_validation_id_fkey";

CREATE UNIQUE INDEX "instrument_validation_id_market_country_symbol_key"
ON "instrument_validation" ("id", "market_country", "symbol");

ALTER TABLE "target_instrument"
ADD CONSTRAINT "target_instrument_validation_identity_fkey"
FOREIGN KEY ("validation_id", "market", "symbol")
REFERENCES "instrument_validation"("id", "market_country", "symbol")
ON DELETE RESTRICT ON UPDATE CASCADE;
