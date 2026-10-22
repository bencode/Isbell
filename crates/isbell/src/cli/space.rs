use clap::Subcommand;
use isbell_proto::identity::Identity;
use serde_json::json;

use super::Ctx;
use super::output::CliError;

#[derive(Subcommand)]
pub enum SpaceCmd {
    /// Create a new space and store its key on this machine.
    Init,
    /// Join an existing space with its key.
    Join {
        key: String,
        /// Leave the current space for this one.
        #[arg(long)]
        force: bool,
    },
    /// Print the space key and the command that adds another machine.
    Show,
    /// Remove the space key and machine identity from this machine.
    Leave,
}

pub fn run(ctx: &Ctx, cmd: SpaceCmd) -> Result<(), CliError> {
    match cmd {
        SpaceCmd::Init => {
            if ctx.paths.read_key()?.is_some() {
                return Err(exists());
            }
            let id = Identity::generate();
            ctx.paths.write_key(&id)?;
            show(ctx, &id);
        }
        SpaceCmd::Join { key, force } => {
            let id =
                Identity::parse(&key).map_err(|err| CliError::new("bad_key", err.to_string()))?;
            match ctx.paths.read_key()? {
                Some(current) if current.sid() == id.sid() => {}
                Some(_) if !force => return Err(exists()),
                current => {
                    if current.is_some() {
                        forget_machine(ctx)?;
                    }
                    ctx.paths.write_key(&id)?;
                }
            }
            show(ctx, &id);
        }
        SpaceCmd::Show => show(ctx, &ctx.identity()?),
        SpaceCmd::Leave => {
            ctx.paths.remove_key()?;
            forget_machine(ctx)?;
        }
    }
    Ok(())
}

fn exists() -> CliError {
    CliError::new(
        "space_exists",
        "this machine already has a space key; use `space show`, or `space join <key> --force`",
    )
}

/// A machine that switches spaces becomes a new machine there.
fn forget_machine(ctx: &Ctx) -> Result<(), CliError> {
    let mut config = ctx.config.clone();
    if config.machine.take().is_some() {
        ctx.paths.save(&config)?;
    }
    Ok(())
}

fn show(ctx: &Ctx, id: &Identity) {
    let key = id.key_string();
    let join = format!("isbell space join {key}");
    if ctx.out.json {
        ctx.out.json(&json!({"key": key, "sid": id.sid(), "join": join}));
    } else {
        println!("Space key (keep it secret; it controls every machine in the space):\n  {key}\n");
        println!("Add another machine:\n  {join}\n  isbell gateway run");
    }
}
