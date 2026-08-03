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
    } = req.body;

    const normalizedAccountId =
      String(account_id || "").trim() ||
      null;

    const normalizedName =
      String(name || "").trim();

    const normalizedOrigin =
      String(origin || "").trim();

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

    const result = db
      .prepare(`
        INSERT INTO clients (
          account_id,
          name,
          logo_url,
          currency,
          origin,
          active
        )
        VALUES (?, ?, ?, ?, ?, ?)
      `)
      .run(
        normalizedAccountId,
        normalizedName,
        String(logo_url || ""),
        String(currency || "BRL"),
        normalizedOrigin,
        active ? 1 : 0
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

    db.prepare(`
      UPDATE clients
      SET
        account_id = ?,
        name = ?,
        logo_url = ?,
        currency = ?,
        origin = ?,
        active = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      accountId,
      name,
      logoUrl,
      currency,
      origin,
      active ? 1 : 0,
      clientId
    );

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