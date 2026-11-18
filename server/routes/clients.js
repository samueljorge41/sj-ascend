import express from "express";
import multer from "multer";
import fs from "fs";
import path from "path";
import db from "../database/db.js";
import { clientLogosDirectory } from "../config/paths.js";

const router = express.Router();

fs.mkdirSync(clientLogosDirectory, {
  recursive: true,
});

const ALLOWED_LOGO_TYPES =
  new Map([
    ["image/png", ".png"],
    ["image/jpeg", ".jpg"],
    ["image/webp", ".webp"],
  ]);

const logoStorage =
  multer.diskStorage({
    destination: (
      req,
      file,
      callback
    ) => {
      callback(
        null,
        clientLogosDirectory
      );
    },

    filename: (
      req,
      file,
      callback
    ) => {
      const extension =
        ALLOWED_LOGO_TYPES.get(
          file.mimetype
        );

      callback(
        null,
        `client-${req.params.id}-${Date.now()}${extension}`
      );
    },
  });

const uploadLogo = multer({
  storage: logoStorage,

  limits: {
    fileSize:
      2 * 1024 * 1024,
    files: 1,
  },

  fileFilter: (
    req,
    file,
    callback
  ) => {
    if (
      !ALLOWED_LOGO_TYPES.has(
        file.mimetype
      )
    ) {
      callback(
        new Error(
          "Envie uma imagem PNG, JPG, JPEG ou WebP."
        )
      );

      return;
    }

    callback(null, true);
  },
});

const ALLOWED_ORIGINS = [
  "Avaloon",
  "SJ Marketing",
];

const ALLOWED_PAYMENT_METHODS = [
  "auto",
  "prepaid",
  "credit_card",
  "other",
  "unknown",
];

function isValidDate(value) {
  if (value === null || value === "") {
    return true;
  }

  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) &&
    date.toISOString().slice(0, 10) === value;
}

function parseMonthlyFee(value) {
  if (value === null || value === "") {
    return null;
  }

  const amount = Number(value);
  return Number.isFinite(amount) && amount >= 0
    ? amount
    : undefined;
}

function parseBillingDay(value) {
  if (value === null || value === "") {
    return null;
  }

  if (typeof value !== "number" && !/^\d+$/.test(String(value))) {
    return undefined;
  }

  const day = typeof value === "number" ? value : Number(value);
  return Number.isInteger(day) && day >= 1 && day <= 31
    ? day
    : undefined;
}

function parseFirstPaymentDate(value) {
  if (value === null || value === "") return null;
  return isValidDate(value) ? value : undefined;
}

function formatClient(
  client,
  req
) {
  if (!client) {
    return null;
  }

  const formattedClient = {
    ...client,
    active: Boolean(client.active),
  };

  if (
    formattedClient.logo_url?.startsWith(
      "/uploads/"
    )
  ) {
    formattedClient.logo_url =
      `${req.protocol}://${req.get(
        "host"
      )}${formattedClient.logo_url}`;
  }

  return formattedClient;
}

function getClientId(req, res) {
  const clientId = Number(
    req.params.id
  );

  if (
    !Number.isInteger(clientId) ||
    clientId <= 0
  ) {
    res.status(400).json({
      error:
        "ID do cliente inválido.",
    });

    return null;
  }

  return clientId;
}

function requireClient(
  req,
  res,
  next
) {
  const clientId =
    getClientId(req, res);

  if (!clientId) {
    return;
  }

  const client = db
    .prepare(`
      SELECT *
      FROM clients
      WHERE id = ?
    `)
    .get(clientId);

  if (!client) {
    res.status(404).json({
      error:
        "Cliente não encontrado.",
    });

    return;
  }

  req.clientId = clientId;
  req.existingClient = client;

  next();
}

function getLocalLogoPath(
  logoUrl
) {
  if (!logoUrl) {
    return null;
  }

  let pathname =
    String(logoUrl);

  try {
    if (/^https?:\/\//i.test(pathname)) {
      pathname =
        new URL(pathname).pathname;
    }
  } catch {
    return null;
  }

  const prefix =
    "/uploads/client-logos/";

  if (
    !pathname.startsWith(prefix)
  ) {
    return null;
  }

  const filename =
    path.basename(pathname);

  return path.join(
    clientLogosDirectory,
    filename
  );
}

function removeLocalLogoFile(
  logoUrl
) {
  const filePath =
    getLocalLogoPath(logoUrl);

  if (
    !filePath ||
    !fs.existsSync(filePath)
  ) {
    return;
  }

  try {
    fs.unlinkSync(filePath);
  } catch (error) {
    console.warn(
      "Não foi possível remover a logo antiga:",
      error
    );
  }
}

/*
 * Lista os clientes cadastrados no sistema.
 */
router.get("/", (req, res) => {
  try {
    const clients = db
      .prepare(`
        SELECT
          id,
          account_id,
          name,
          logo_url,
          currency,
          origin,
          active,
          payment_method,
          monthly_fee,
          billing_day,
          first_payment_date,
          entry_date,
          exit_date,
          last_synced_at,
          created_at,
          updated_at
        FROM clients
        ORDER BY name ASC
      `)
      .all()
      .map((client) =>
        formatClient(client, req)
      );

    res.json({ clients });
  } catch (error) {
    console.error(
      "Erro ao listar clientes:",
      error
    );

    res.status(500).json({
      error:
        "Não foi possível listar os clientes.",
    });
  }
});

/*
 * Lista as contas de anúncio encontradas na Meta.
 */
router.get("/meta-accounts", (req, res) => {
  try {
    const accounts = db
      .prepare(`
        SELECT
          id,
          account_id,
          name,
          currency,
          last_synced_at,
          created_at,
          updated_at
        FROM meta_accounts
        ORDER BY name ASC
      `)
      .all();

    res.json({ accounts });
  } catch (error) {
    console.error(
      "Erro ao listar contas Meta:",
      error
    );

    res.status(500).json({
      error:
        "Não foi possível listar as contas Meta.",
    });
  }
});

/*
 * Cria manualmente um cliente.
 */
router.post("/", (req, res) => {
  try {
    const {
      account_id,
      name = "",
      logo_url = "",
      currency = "BRL",
      origin = "",
      active = false,
      payment_method = "auto",
      monthly_fee = null,
      billing_day = null,
      first_payment_date = null,
      entry_date,
      exit_date = null,
    } = req.body;

    const normalizedAccountId =
      String(account_id || "").trim() ||
      null;

    const normalizedName =
      String(name || "").trim();

    const normalizedOrigin =
      String(origin || "").trim();

    const normalizedPaymentMethod =
      String(payment_method || "auto");
    const normalizedMonthlyFee =
      parseMonthlyFee(monthly_fee);
    const normalizedBillingDay =
      parseBillingDay(billing_day);
    const normalizedFirstPaymentDate =
      parseFirstPaymentDate(first_payment_date);
    const normalizedEffectiveBillingDay = normalizedFirstPaymentDate
      ? Number(normalizedFirstPaymentDate.slice(-2))
      : normalizedBillingDay;
    const normalizedEntryDate =
      entry_date === undefined
        ? db.prepare("SELECT date('now') AS date").get().date
        : entry_date;

    if (!normalizedName) {
      return res.status(400).json({
        error:
          "O nome do cliente é obrigatório.",
      });
    }

    if (
      normalizedOrigin &&
      !ALLOWED_ORIGINS.includes(
        normalizedOrigin
      )
    ) {
      return res.status(400).json({
        error:
          "Origem do cliente inválida.",
      });
    }

    if (
      !ALLOWED_PAYMENT_METHODS.includes(
        normalizedPaymentMethod
      )
    ) {
      return res.status(400).json({
        error:
          "Forma de pagamento invÃ¡lida.",
      });
    }

    if (
      normalizedMonthlyFee === undefined ||
      normalizedBillingDay === undefined ||
      normalizedFirstPaymentDate === undefined ||
      !isValidDate(normalizedEntryDate) ||
      !isValidDate(exit_date)
    ) {
      return res.status(400).json({
        error: "Informe uma mensalidade válida e datas válidas.",
      });
    }

    const result = db
      .prepare(`
        INSERT INTO clients (
          account_id,
          name,
          logo_url,
          currency,
          origin,
          active,
          payment_method,
          monthly_fee,
          billing_day,
          first_payment_date,
          entry_date,
          exit_date
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        normalizedAccountId,
        normalizedName,
        String(logo_url || ""),
        String(currency || "BRL"),
        normalizedOrigin,
        active ? 1 : 0,
        normalizedPaymentMethod,
        normalizedMonthlyFee,
        normalizedEffectiveBillingDay,
        normalizedFirstPaymentDate,
        normalizedEntryDate,
        exit_date || null
      );

    const client = db
      .prepare(`
        SELECT *
        FROM clients
        WHERE id = ?
      `)
      .get(result.lastInsertRowid);

    res.status(201).json({
      client: formatClient(
        client,
        req
      ),
    });
  } catch (error) {
    if (
      error.code ===
      "SQLITE_CONSTRAINT_UNIQUE"
    ) {
      return res.status(409).json({
        error:
          "Esta conta Meta já está vinculada a outro cliente.",
      });
    }

    console.error(
      "Erro ao criar cliente:",
      error
    );

    res.status(500).json({
      error:
        "Não foi possível criar o cliente.",
    });
  }
});

function normalizeMetaAccountId(account) {
  const rawId =
    account.id ||
    account.account_id ||
    "";

  const cleanId = String(rawId).replace(
    /^act_/,
    ""
  );

  return cleanId
    ? `act_${cleanId}`
    : "";
}

async function fetchMetaAccounts(token) {
  const accounts = [];

  let nextUrl =
    "https://graph.facebook.com/v25.0/me/adaccounts" +
    "?fields=id,account_id,name,currency" +
    "&limit=200";

  let pageCount = 0;

  while (
    nextUrl &&
    pageCount < 20
  ) {
    pageCount += 1;

    const response = await fetch(
      nextUrl,
      {
        headers: {
          Authorization:
            `Bearer ${token}`,
        },
      }
    );

    const data =
      await response.json();

    if (
      !response.ok ||
      data.error
    ) {
      throw new Error(
        data.error?.message ||
          "Não foi possível buscar as contas da Meta."
      );
    }

    accounts.push(
      ...(data.data || [])
    );

    nextUrl =
      data.paging?.next ||
      null;
  }

  return accounts;
}

/*
 * Sincroniza as contas Meta com a tabela meta_accounts.
 */
router.post("/sync", async (req, res) => {
  try {
    const token =
      process.env.META_ACCESS_TOKEN;

    if (!token) {
      return res.status(500).json({
        error:
          "META_ACCESS_TOKEN não configurado.",
      });
    }

    const metaAccounts =
      await fetchMetaAccounts(token);

    const upsertAccount = db.prepare(`
      INSERT INTO meta_accounts (
        account_id,
        name,
        currency,
        last_synced_at
      )
      VALUES (
        ?,
        ?,
        ?,
        CURRENT_TIMESTAMP
      )

      ON CONFLICT(account_id)
      DO UPDATE SET
        name = excluded.name,
        currency = excluded.currency,
        last_synced_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
    `);

    const syncTransaction =
      db.transaction((accounts) => {
        for (
          const account of accounts
        ) {
          const accountId =
            normalizeMetaAccountId(
              account
            );

          if (!accountId) {
            continue;
          }

          upsertAccount.run(
            accountId,
            String(
              account.name || ""
            ),
            String(
              account.currency ||
                "BRL"
            )
          );
        }
      });

    syncTransaction(metaAccounts);

    const accounts = db
      .prepare(`
        SELECT
          id,
          account_id,
          name,
          currency,
          last_synced_at,
          created_at,
          updated_at
        FROM meta_accounts
        ORDER BY name ASC
      `)
      .all();

    res.json({
      message:
        "Contas sincronizadas com sucesso.",
      synchronized:
        metaAccounts.length,
      accounts,
    });
  } catch (error) {
    console.error(
      "Erro ao sincronizar contas:",
      error
    );

    res.status(500).json({
      error:
        error.message ||
        "Não foi possível sincronizar as contas.",
    });
  }
});

/*
 * Envia ou substitui a logo de um cliente.
 */
router.post(
  "/:id/logo",
  requireClient,
  (req, res) => {
    uploadLogo.single("logo")(
      req,
      res,
      (uploadError) => {
        if (uploadError) {
          const message =
            uploadError.code ===
            "LIMIT_FILE_SIZE"
              ? "A imagem deve ter no máximo 2 MB."
              : uploadError.message ||
                "Não foi possível enviar a logo.";

          return res.status(400).json({
            error: message,
          });
        }

        if (!req.file) {
          return res.status(400).json({
            error:
              "Selecione uma imagem para a logo.",
          });
        }

        const previousLogoUrl =
          req.existingClient.logo_url;

        const logoUrl =
          `/uploads/client-logos/${req.file.filename}`;

        try {
          db.prepare(`
            UPDATE clients
            SET
              logo_url = ?,
              updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
          `).run(
            logoUrl,
            req.clientId
          );

          const updatedClient = db
            .prepare(`
              SELECT *
              FROM clients
              WHERE id = ?
            `)
            .get(req.clientId);

          removeLocalLogoFile(
            previousLogoUrl
          );

          return res.json({
            client: formatClient(
              updatedClient,
              req
            ),
          });
        } catch (error) {
          removeLocalLogoFile(
            logoUrl
          );

          console.error(
            "Erro ao salvar logo do cliente:",
            error
          );

          return res.status(500).json({
            error:
              "Não foi possível salvar a logo do cliente.",
          });
        }
      }
    );
  }
);

/*
 * Remove a logo de um cliente.
 */
router.delete(
  "/:id/logo",
  requireClient,
  (req, res) => {
    try {
      const previousLogoUrl =
        req.existingClient.logo_url;

      db.prepare(`
        UPDATE clients
        SET
          logo_url = '',
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(req.clientId);

      const updatedClient = db
        .prepare(`
          SELECT *
          FROM clients
          WHERE id = ?
        `)
        .get(req.clientId);

      removeLocalLogoFile(
        previousLogoUrl
      );

      res.json({
        client: formatClient(
          updatedClient,
          req
        ),
      });
    } catch (error) {
      console.error(
        "Erro ao remover logo do cliente:",
        error
      );

      res.status(500).json({
        error:
          "Não foi possível remover a logo do cliente.",
      });
    }
  }
);

/*
 * Atualiza um cliente existente.
 */
router.patch("/:id", (req, res) => {
  try {
    const clientId =
      Number(req.params.id);

    if (
      !Number.isInteger(clientId) ||
      clientId <= 0
    ) {
      return res.status(400).json({
        error:
          "ID do cliente inválido.",
      });
    }

    const existingClient = db
      .prepare(`
        SELECT *
        FROM clients
        WHERE id = ?
      `)
      .get(clientId);

    if (!existingClient) {
      return res.status(404).json({
        error:
          "Cliente não encontrado.",
      });
    }

    const accountId =
      req.body.account_id !==
      undefined
        ? String(
            req.body.account_id || ""
          ).trim() || null
        : existingClient.account_id;

    const name =
      req.body.name !== undefined
        ? String(
            req.body.name
          ).trim()
        : existingClient.name;

    const logoUrl =
      req.body.logo_url !==
      undefined
        ? String(
            req.body.logo_url || ""
          )
        : existingClient.logo_url;

    const currency =
      req.body.currency !==
      undefined
        ? String(
            req.body.currency ||
              "BRL"
          )
        : existingClient.currency ||
          "BRL";

    const origin =
      req.body.origin !== undefined
        ? String(
            req.body.origin || ""
          ).trim()
        : existingClient.origin ||
          "";

    const active =
      req.body.active !== undefined
        ? Boolean(
            req.body.active
          )
        : Boolean(
            existingClient.active
          );

    const paymentMethod =
      req.body.payment_method !==
      undefined
        ? String(req.body.payment_method)
        : existingClient.payment_method ||
          "auto";
    const monthlyFee =
      req.body.monthly_fee !== undefined
        ? parseMonthlyFee(req.body.monthly_fee)
        : existingClient.monthly_fee;
    const firstPaymentDate =
      req.body.first_payment_date !== undefined
        ? parseFirstPaymentDate(req.body.first_payment_date)
        : existingClient.first_payment_date || null;
    const billingDay =
      req.body.first_payment_date !== undefined
        ? firstPaymentDate
          ? Number(firstPaymentDate.slice(-2))
          : existingClient.first_payment_date
            ? null
            : existingClient.billing_day
        : req.body.billing_day !== undefined
          ? parseBillingDay(req.body.billing_day)
          : existingClient.billing_day;
    const entryDate =
      req.body.entry_date !== undefined
        ? req.body.entry_date || null
        : existingClient.entry_date ||
          db.prepare("SELECT date(created_at) AS date FROM clients WHERE id = ?").get(clientId).date;
    const requestedExitDate =
      req.body.exit_date !== undefined
        ? req.body.exit_date || null
        : existingClient.exit_date || null;
    const transitioningToInactive =
      Boolean(existingClient.active) && !active;
    const transitioningToActive =
      !Boolean(existingClient.active) && active;
    const manuallyChangedExitDate =
      req.body.exit_date !== undefined &&
      Boolean(requestedExitDate) &&
      requestedExitDate !== (existingClient.exit_date || null);
    const today =
      db.prepare("SELECT date('now') AS date").get().date;
    const exitDate =
      transitioningToActive
        ? null
        : transitioningToInactive
          ? manuallyChangedExitDate
            ? requestedExitDate
            : today
          : requestedExitDate;
    const newPeriodStart =
      transitioningToActive
        ? req.body.entry_date !== undefined &&
          req.body.entry_date !== existingClient.entry_date &&
          isValidDate(entryDate) &&
          Boolean(entryDate)
          ? entryDate
          : today
        : null;

    if (!name) {
      return res.status(400).json({
        error:
          "O nome do cliente é obrigatório.",
      });
    }

    if (
      origin &&
      !ALLOWED_ORIGINS.includes(
        origin
      )
    ) {
      return res.status(400).json({
        error:
          "Origem do cliente inválida.",
      });
    }

    if (
      !ALLOWED_PAYMENT_METHODS.includes(
        paymentMethod
      )
    ) {
      return res.status(400).json({
        error:
          "Forma de pagamento invÃ¡lida.",
      });
    }

    if (
      monthlyFee === undefined ||
      billingDay === undefined ||
      firstPaymentDate === undefined ||
      !isValidDate(entryDate) ||
      !isValidDate(exitDate)
    ) {
      return res.status(400).json({
        error: "Informe uma mensalidade válida e datas válidas.",
      });
    }

    db.transaction(() => {
      db.prepare(`
        UPDATE clients
        SET
          account_id = ?,
          name = ?,
          logo_url = ?,
          currency = ?,
          origin = ?,
          active = ?,
          payment_method = ?,
          monthly_fee = ?,
          billing_day = ?,
          first_payment_date = ?,
          entry_date = ?,
          exit_date = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(
        accountId,
        name,
        logoUrl,
        currency,
        origin,
        active ? 1 : 0,
        paymentMethod,
        monthlyFee,
        billingDay,
        firstPaymentDate,
        entryDate,
        exitDate,
        clientId
      );

      if (transitioningToInactive) {
        const openPeriod = db.prepare(`
          SELECT id
          FROM client_relationship_periods
          WHERE client_id = ? AND ended_on IS NULL
          ORDER BY id DESC
          LIMIT 1
        `).get(clientId);

        if (openPeriod) {
          db.prepare(`
            UPDATE client_relationship_periods
            SET
              started_on = CASE WHEN ? THEN ? ELSE started_on END,
              ended_on = ?
            WHERE id = ?
          `).run(
            req.body.entry_date !== undefined &&
              req.body.entry_date !== existingClient.entry_date
              ? 1
              : 0,
            entryDate,
            exitDate,
            openPeriod.id
          );
        } else if (
          !existingClient.exit_date &&
          isValidDate(entryDate) &&
          exitDate >= entryDate
        ) {
          db.prepare(`
            INSERT INTO client_relationship_periods (
              client_id, started_on, ended_on, source
            ) VALUES (?, ?, ?, 'tracked')
          `).run(clientId, entryDate, exitDate);
        }
      } else if (transitioningToActive) {
        const staleOpenPeriod = db.prepare(`
          SELECT id, started_on
          FROM client_relationship_periods
          WHERE client_id = ? AND ended_on IS NULL
          ORDER BY id DESC
          LIMIT 1
        `).get(clientId);

        if (staleOpenPeriod) {
          const fallbackEnd = db.prepare(
            "SELECT date(?, '-1 day') AS date"
          ).get(newPeriodStart).date;
          const safeEnd = fallbackEnd >= staleOpenPeriod.started_on
            ? fallbackEnd
            : staleOpenPeriod.started_on;
          db.prepare(`
            UPDATE client_relationship_periods
            SET ended_on = ?
            WHERE id = ?
          `).run(safeEnd, staleOpenPeriod.id);
        }

        db.prepare(`
          INSERT INTO client_relationship_periods (
            client_id, started_on, ended_on, source
          ) VALUES (?, ?, NULL, 'tracked')
        `).run(clientId, newPeriodStart);
      } else if (
        req.body.entry_date !== undefined &&
        req.body.entry_date !== existingClient.entry_date
      ) {
        db.prepare(`
          UPDATE client_relationship_periods
          SET started_on = ?
          WHERE client_id = ? AND ended_on IS NULL
        `).run(entryDate, clientId);
      }

      if (
        !active &&
        !transitioningToInactive &&
        req.body.exit_date !== undefined &&
        requestedExitDate !== (existingClient.exit_date || null)
      ) {
        db.prepare(`
          UPDATE client_relationship_periods
          SET ended_on = ?
          WHERE id = (
            SELECT id
            FROM client_relationship_periods
            WHERE client_id = ? AND ended_on IS NOT NULL
            ORDER BY id DESC
            LIMIT 1
          )
        `).run(requestedExitDate, clientId);
      }
    })();

    const updatedClient = db
      .prepare(`
        SELECT *
        FROM clients
        WHERE id = ?
      `)
      .get(clientId);

    res.json({
      client:
        formatClient(
          updatedClient,
          req
        ),
    });
  } catch (error) {
    if (
      error.code ===
      "SQLITE_CONSTRAINT_UNIQUE"
    ) {
      return res.status(409).json({
        error:
          "Esta conta Meta já está vinculada a outro cliente.",
      });
    }

    console.error(
      "Erro ao atualizar cliente:",
      error
    );

    res.status(500).json({
      error:
        "Não foi possível atualizar o cliente.",
    });
  }
});

/*
 * Exclui definitivamente um cliente.
 *
 * Operações, demandas e dados de boleto
 * são excluídos automaticamente pelo
 * ON DELETE CASCADE do banco.
 *
 * A conta Meta sincronizada não é excluída.
 */
router.delete("/:id", (req, res) => {
  try {
    const clientId =
      Number(req.params.id);

    if (
      !Number.isInteger(clientId) ||
      clientId <= 0
    ) {
      return res.status(400).json({
        error:
          "ID do cliente inválido.",
      });
    }

    const existingClient = db
      .prepare(`
        SELECT
          id,
          name,
          account_id,
          logo_url
        FROM clients
        WHERE id = ?
      `)
      .get(clientId);

    if (!existingClient) {
      return res.status(404).json({
        error:
          "Cliente não encontrado.",
      });
    }

    const deleteTransaction =
      db.transaction(() => {
        /*
         * overview_cache não possui
         * chave estrangeira para clients.
         *
         * Por isso, limpamos manualmente
         * o cache relacionado à conta.
         */
        if (
          existingClient.account_id
        ) {
          const cleanAccountId =
            String(
              existingClient.account_id
            ).replace(/^act_/, "");

          db.prepare(`
            DELETE FROM overview_cache
            WHERE account_id IN (?, ?)
          `).run(
            cleanAccountId,
            `act_${cleanAccountId}`
          );
        }

        return db
          .prepare(`
            DELETE FROM clients
            WHERE id = ?
          `)
          .run(clientId);
      });

    const result =
      deleteTransaction();

    if (result.changes === 0) {
      return res.status(404).json({
        error:
          "Cliente não encontrado.",
      });
    }

    removeLocalLogoFile(
      existingClient.logo_url
    );

    res.json({
      message:
        "Cliente excluído com sucesso.",

      deleted_id:
        existingClient.id,

      deleted_name:
        existingClient.name,

      deleted_account_id:
        existingClient.account_id ||
        null,
    });
  } catch (error) {
    console.error(
      "Erro ao excluir cliente:",
      error
    );

    res.status(500).json({
      error:
        "Não foi possível excluir o cliente.",
    });
  }
});

export default router;
