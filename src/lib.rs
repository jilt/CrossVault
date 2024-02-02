use solana_program::{
	account_info::AccountInfo,
	entrypoint,
	entrypoint::ProgramResult,
	pubkey::Pubkey,
	msg,
};

// declare and export the program entrypoint

entrypoint!(process_instruction);

// entrypoint implementation

pub_fn process_instruction(
	program_id: &Pubkey,
	accounts: &[AccountInfo],
	instruction_data: &[u8]	
	)-> ProgramResult {

	// log a message to the blockchain

	msg!("feanor!");

	// gracefully exit the program
	Ok(()
)
	}
